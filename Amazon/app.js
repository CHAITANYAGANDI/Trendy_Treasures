require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const path = require('path');
const { randomUUID } = require('crypto');

const ProductRouter = require('./Routes/ProductRouter');
const OrderRouter = require('./Routes/OrderRouter');
const PaymentRouter = require('./Routes/PaymentRouter');
const {
    clientIdentityKey,
    trustProxySetting,
    describePlatform
} = require('./Middlewares/clientIdentity');


const app = express();
const PORT = process.env.PORT || 8000;

const requireProdEnv = () => {
    if (process.env.NODE_ENV !== 'production') return;
    const required = [
        'MONGO_CONN',
        'SECRET',
        'AUTH_SERVER_URL',
        'INTERNAL_AUTH_SECRET',
        'TT_GATEWAY_URL',
        'CORS_ORIGINS',
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY'
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
        console.error(`[amazon] FATAL: missing required production env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
};

requireProdEnv();

require('./Models/dbConnection');


const isProduction = process.env.NODE_ENV === 'production';

// Proxy trust comes from the platform preset rather than a hard-coded hop
// count, so the same image runs on Cloud Run, on Render and locally.
// See Middlewares/clientIdentity.js.
app.set('trust proxy', trustProxySetting(process.env));


app.use((req, res, next) => {
    const id = req.headers['x-request-id'] || randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    console.log(`[amazon] [${id}] ${req.method} ${req.originalUrl}`);
    next();
});


// Helmet defaults — HSTS, X-Content-Type-Options, frame-deny, etc. CSP is
// off because the source-branded checkout page (public/checkout.html) loads
// Stripe.js cross-origin and inline scripts; tightening that needs a
// per-page CSP rather than a global one, which is out of scope here.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: 'same-origin' }
}));


// Service-level rate limit. Amazon stays publicly reachable during the
// Cloud Run migration, so the gateway's own IP limit is not sufficient on
// its own. /payments/* gets a tighter window because each call hits Stripe
// and costs money on abuse.
//
// Every request proxied by the APIGateway arrives from the gateway's single
// egress IP, so keying purely on req.ip lumped all shoppers into one bucket
// and 429'd the storefront under trivial load. The resolver trusts the
// gateway's x-real-client-ip only when x-internal-auth verifies with a
// timing-safe comparison, so a caller reaching this service directly cannot
// forge someone else's key. See Middlewares/clientIdentity.js.
//
// The resolver's default /64 IPv6 normalisation matches what this service
// did before (express-rate-limit v7 doesn't export ipKeyGenerator).
const rateLimitKey = (req) => clientIdentityKey(req);

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many requests, slow down.' }
}));

app.use('/payments', rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.PAYMENTS_RATE_LIMIT_PER_MIN || '20', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: { error: 'Too many payment attempts. Try again later.' }
}));


app.use(bodyParser.json({ limit: '32kb' }));
app.use(cookieParser());

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    exposedHeaders: ['x-original-url', 'x-request-id']
}));


app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'amazon',
        uptime: process.uptime(),
        mongoState: mongoose.connection.readyState
    });
});


// ─── Source-branded mock storefront (provider redirect target) ─────────────
//
// TrendyTreasures (the aggregator) redirects the buyer here for the final
// checkout step, so the experience visually leaves the aggregator and lands
// on what looks like Amazon. The pages call back into the TrendyTreasures
// gateway to actually persist the order — this service never stores orders.
app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/confirmation', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'confirmation.html'));
});

// Exposes only the Stripe publishable key to the browser. The secret key
// stays server-side. Returned as JS so the checkout page can `<script src>`
// it before the main checkout.js runs.
app.get('/config.js', (req, res) => {
    const publicGatewayUrl =
        process.env.TT_GATEWAY_PUBLIC_URL ||
        process.env.TT_GATEWAY_URL ||
        '';

    res.type('application/javascript').send(
        `window.STRIPE_PK = ${JSON.stringify(process.env.STRIPE_PUBLISHABLE_KEY || '')};\n` +
        `window.TT_GATEWAY_URL = ${JSON.stringify(publicGatewayUrl)};\n` +
        `window.TRENDY_TREASURES_URL = ${JSON.stringify(process.env.TRENDY_TREASURES_URL || '')};`
    );
});


app.use('/orders', OrderRouter);
app.use('/payments', PaymentRouter);

app.use('/', ProductRouter);


// Host is intentionally omitted: Node then binds all interfaces, which is
// what Cloud Run requires. PORT is supplied by the platform at runtime.
app.listen(PORT, () => {
    console.log(`[amazon] listening on ${PORT}`);
    console.log(`[amazon] client-identity: ${describePlatform(process.env)}`);
});
