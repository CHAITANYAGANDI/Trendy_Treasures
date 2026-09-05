require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

const { validateEnv } = require('./utils/env');
const logger = require('./utils/logger');

// Fail-fast on missing env BEFORE we bind routes — saves a deploy from
// landing in a half-broken state.
validateEnv();

const Router = require('./Routes/router');
const GoogleAuthRouter = require('./Routes/GoogleAuthRouter');

require('./Models/dbConnection');


const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const isDev = !isProduction;
const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Trust the first proxy hop. Production runs behind a load balancer/CDN,
// so without this `req.ip` would be the LB's IP and rate limits would
// bucket everyone together. The default `1` accepts X-Forwarded-* from
// exactly one upstream — tighten or loosen based on your topology.
app.set('trust proxy', 1);

// Reject UUIDs that don't look like UUIDs/short tokens — otherwise the
// header is a log-injection vector since we echo it in responses and logs.
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && REQUEST_ID_RE.test(incoming))
        ? incoming
        : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    logger.info('request', {
        request_id: id,
        method: req.method,
        url: logger.redactUrl(req.originalUrl)
    });
    next();
});


const formActionOrigins = (process.env.FORM_ACTION_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.use(helmet({
    contentSecurityPolicy: isProduction
        ? {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'form-action': ["'self'", ...formActionOrigins],
            },
        }
        : false,
    crossOriginEmbedderPolicy: isProduction ? undefined : false,
    crossOriginOpenerPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: isProduction ? undefined : false,
    referrerPolicy: { policy: 'same-origin' }
}));

// Service-to-service token endpoints. These are called by the APIGateway
// (RS256 assertion) and by Amazon/Walmart (x-internal-auth), so they all
// arrive from a handful of fixed egress IPs and would otherwise share the
// same 200-per-15-minute budget as a single browser. When that budget ran
// out, provider tokens could no longer be refreshed and the storefront lost
// its entire catalogue until traffic died down. Both endpoints are already
// gated by cryptographic auth, so give them their own, much larger budget.
const INTERNAL_TOKEN_PATHS = ['/auth/token/refresh', '/auth/token/active'];
const isInternalTokenPath = (req) =>
    INTERNAL_TOKEN_PATHS.some((prefix) => req.path.startsWith(prefix));

const internalTokenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.INTERNAL_TOKEN_RATE_LIMIT_PER_MIN || '600', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many token requests, slow down.' }
});

app.use(INTERNAL_TOKEN_PATHS, internalTokenLimiter);

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    // Covered by internalTokenLimiter above — don't bill them twice.
    skip: isInternalTokenPath
}));


// Cap payload size on every parser. Auth requests are small (login,
// register, OTP, credentials). Anything bigger is almost certainly abuse.
const BODY_LIMIT = '16kb';
app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'Views'));

app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(express.json({ limit: BODY_LIMIT }));


const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

logger.info('cors_allowlist', { origins: allowedOrigins, dev: isDev });

app.use(cors({
    origin: function (origin, cb) {
        // No Origin header — same-origin or non-browser. Let through.
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        // Dev fallback: only allow localhost loopback. We no longer accept
        // `Origin: null` because it's both unnecessary and a sandboxed-iframe
        // attack vector.
        if (isDev && localhostRegex.test(origin)) {
            return cb(null, true);
        }
        logger.warn('cors_blocked', { origin });
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-request-id'],
    credentials: true
}));


// Liveness — always OK if the process is up. Used by orchestrators that
// only care whether to restart the container.
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-server', uptime: process.uptime() });
});

// Readiness — only OK if Mongo is connected. Used by load balancers /
// k8s readiness probes that gate traffic. readyState === 1 is connected.
app.get('/ready', (req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({
        status: ok ? 'ready' : 'not_ready',
        mongoState: mongoose.connection.readyState
    });
});


app.use('/auth', GoogleAuthRouter);
app.use('/auth', Router);


// 404 + global error handler. The default Express handler leaks stack
// traces when NODE_ENV !== 'production'; this returns a stable JSON
// shape and logs the underlying error server-side.
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error('unhandled_error', {
        request_id: req.requestId,
        message: err.message,
        stack: isProduction ? undefined : err.stack
    });
    if (res.headersSent) return;
    res.status(err.status || 500).json({
        success: false,
        message: isProduction ? 'Internal server error' : err.message
    });
});


// Only bind the port / install signal handlers when this file is the
// entrypoint (e.g. `node app.js` or the Docker CMD). When required from
// a test runner we just want the configured Express app — no listener,
// no signal hooks, no process.exit on rejection.
if (require.main === module) {
    const server = app.listen(PORT, () => {
        logger.info('listening', { port: PORT });
    });

    // Graceful shutdown — let in-flight requests finish, then close Mongo.
    // Without this, rolling deploys / SIGTERM mid-request lose those requests
    // and leave half-written DB state on the floor.
    const shutdown = (signal) => {
        logger.info('shutdown_start', { signal });
        server.close(async (err) => {
            if (err) {
                logger.error('http_close_error', { message: err.message });
            }
            try {
                await mongoose.connection.close(false);
                logger.info('shutdown_complete');
                process.exit(0);
            } catch (e) {
                logger.error('mongo_close_error', { message: e.message });
                process.exit(1);
            }
        });
        // If anything is stuck, hard-exit after 30s.
        setTimeout(() => {
            logger.error('shutdown_force');
            process.exit(1);
        }, 30_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Last-resort safety nets — log and exit so an orchestrator can restart
    // us. Leaving a process running in an unknown state is worse than crashing.
    process.on('unhandledRejection', (reason) => {
        logger.error('unhandled_rejection', { reason: String(reason) });
    });
    process.on('uncaughtException', (err) => {
        logger.error('uncaught_exception', { message: err.message, stack: err.stack });
        process.exit(1);
    });
}

module.exports = app;
