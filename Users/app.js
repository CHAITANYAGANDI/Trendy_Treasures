require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const AuthRouter = require('./Routes/AuthRouter');
const googleAuthRouter = require('./Routes/GoogleAuthRouter');
const passwordResetRouter = require('./Routes/PasswordResetRouter');
const cartRouter = require('./Routes/CartRouter');
const CheckoutIntentRouter = require('./Routes/CheckoutIntentRouter');
const AdminRouter = require('./Routes/AdminRouter');
const AccountRouter = require('./Routes/AccountRouter');
const PriceRouter = require('./Routes/PriceRouter');
const AIRouter = require('./Routes/AIRouter');
const { issueCsrfToken, requireCsrf } = require('./Middlewares/csrf');
const {
    clientIdentityKey,
    trustProxySetting,
    describePlatform
} = require('./Middlewares/clientIdentity');


const app = express();
const PORT = process.env.PORT || 7001;

const requireProdEnv = () => {
    if (process.env.NODE_ENV !== 'production') return;
    const required = [
        'MONGO_CONN',
        'JWT_SECRET',
        'INTERNAL_AUTH_SECRET',
        'CORS_ORIGINS',
        'CLIENT_URL',
        'AUTH_SERVER_URL',
        'API_GATEWAY_URL',
        'BREVO_API_KEY',
        'MAIL_FROM'
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
        console.error(`[users] FATAL: missing required production env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
    if ((process.env.JWT_SECRET || '').length < 32) {
        console.error('[users] FATAL: JWT_SECRET is too short for production (need >=32 chars).');
        process.exit(1);
    }

    // Google sign-in is optional, but a HALF-configured client is worse
    // than none: the button would bounce the user to a raw Google
    // "invalid_client" page. Either set all three or leave all three empty.
    const googleVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
    const googleSet = googleVars.filter((name) => process.env[name]);
    if (googleSet.length > 0 && googleSet.length < googleVars.length) {
        const absent = googleVars.filter((name) => !process.env[name]);
        console.error(`[users] FATAL: partial Google OAuth config — also set: ${absent.join(', ')}`);
        process.exit(1);
    }
    // The storefront reaches Users through the gateway, so the OAuth
    // round-trip must come back through the gateway too or the state and
    // session cookies land on a host the SPA never talks to.
    if (googleSet.length === googleVars.length && !String(process.env.GOOGLE_REDIRECT_URI).includes('/user/auth/google/callback')) {
        console.warn('[users] WARNING: GOOGLE_REDIRECT_URI should point at the APIGateway path (…/api/v1/user/auth/google/callback), not directly at this service.');
    }
};

requireProdEnv();

require('./Models/db');


const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);


const isProduction = process.env.NODE_ENV === 'production';

// Proxy trust comes from the platform preset rather than a hard-coded hop
// count, so the same image runs on Cloud Run, on Render and locally.
// See Middlewares/clientIdentity.js.
app.set('trust proxy', trustProxySetting(process.env));


app.use((req, res, next) => {
    const id = req.headers['x-request-id'] || randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    console.log(`[users] [${id}] ${req.method} ${req.originalUrl}`);
    next();
});


// helmet defaults set secure response headers (X-Content-Type-Options,
// Strict-Transport-Security, X-Frame-Options, etc.). CSP is disabled in dev
// because the React dev server cross-origin loads scripts that the default
// directives would block; in prod CSP is on with defaults.
app.use(helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: isProduction ? undefined : false,
    crossOriginOpenerPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: isProduction ? undefined : false,
    referrerPolicy: { policy: 'same-origin' }
}));


// Service-level rate limit. The gateway already enforces 120/min IP-wide,
// but Users is also publicly reachable directly on Render unless you put
// it on private networking — so we duplicate the limit here as defense in
// depth. Internal callbacks (the gateway → /internal/price-drop path) are
// gated by INTERNAL_AUTH_SECRET and skipped here so a busy alert burst
// doesn't trip the limiter.
const isInternalRoute = (req) => req.path.startsWith('/internal/');

// Requests proxied by the APIGateway all arrive from the gateway's single
// egress IP, so keying on req.ip alone put every shopper into one bucket and
// 429'd the storefront under trivial load. The gateway forwards the real
// client IP alongside the shared internal secret; the resolver below trusts
// it only when that secret verifies with a timing-safe comparison, so a
// caller reaching this service directly cannot forge another shopper's key.
// That matters during the Cloud Run migration, where this service stays
// publicly reachable.
//
// `normalize` keeps this service's existing IPv6 subnet behaviour —
// express-rate-limit v8's ipKeyGenerator — rather than the resolver's /64
// default, so bucket semantics don't change.
const rateLimitKey = (req) =>
    clientIdentityKey(req, { normalize: (ip) => ipKeyGenerator(ip) });

const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    skip: isInternalRoute,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many requests, slow down.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_PER_15M || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many auth attempts. Try again later.' }
});

app.use(generalLimiter);
// Login/signup/OTP/admin-login/recovery get the tighter window. These run
// before bodyParser and the routers so cheap drops don't allocate body
// parsing or DB I/O for each abuse attempt.
app.use('/auth/login', authLimiter);
app.use('/auth/signup', authLimiter);
app.use('/auth/verifyotp', authLimiter);
app.use('/admin/login', authLimiter);
app.use('/recovery', authLimiter);


app.use(bodyParser.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(issueCsrfToken);
app.use(requireCsrf);


// CSRF token endpoint. The SPA calls this on boot to learn the current
// double-submit token. We can't expose the cookie value via JS at the SPA
// origin (the API is on a different registrable domain on Render, so
// document.cookie can't read it), so the SPA must learn the value from
// a request body. The cookie is still set + still sent automatically by
// the browser on every request — requireCsrf compares cookie vs header
// as usual.
app.get('/csrf-token', (req, res) => {
    res.json({ success: true, csrfToken: res.locals.csrfToken });
});


app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'users',
        uptime: process.uptime(),
        mongoState: mongoose.connection.readyState
    });
});


app.use('/', googleAuthRouter);
app.use('/auth', AuthRouter);
app.use('/admin', AdminRouter);
app.use('/recovery', passwordResetRouter);
app.use('/account', AccountRouter);
app.use('/cart', cartRouter);
app.use('/checkout', CheckoutIntentRouter);
app.use('/prices', PriceRouter);
app.use('/ai', AIRouter);

// Internal endpoint called by the gateway when a snapshot crosses an
// alert threshold. Lives outside /prices so the gateway POSTs to a
// distinct URL — easier to firewall in prod if you ever want to expose
// /prices/* publicly but lock /internal/* down to private networking.
app.post('/internal/price-drop', PriceRouter.internalPriceDrop);


// Host is intentionally omitted: Node then binds all interfaces, which is
// what Cloud Run requires. PORT is supplied by the platform at runtime.
app.listen(PORT, () => {
    console.log(`[users] listening on ${PORT}`);
    console.log(`[users] client-identity: ${describePlatform(process.env)}`);
});
