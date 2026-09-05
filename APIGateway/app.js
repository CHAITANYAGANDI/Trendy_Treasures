require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

require('./Models/dbConnection');
const CredsModel = require('./Models/Credential');
const PriceSnapshot = require('./Models/PriceSnapshot');
const PriceAlert = require('./Models/PriceAlert');


const app = express();
const PORT = process.env.PORT || 7000;
const USERS_TARGET = process.env.USERS_SERVICE_URL || 'http://localhost:7001';
const AMAZON_TARGET = process.env.AMAZON_SERVICE_URL || 'http://localhost:8000';
const WALMART_TARGET = process.env.WALMART_SERVICE_URL || 'http://127.0.0.1:8001';
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:5000';

// Asymmetric JWT bearer (RFC 7523) for service-to-service auth against the
// auth server's /auth/token/refresh endpoint. The gateway holds the private
// key; the auth server holds only the matching public key. A leak of the
// auth server's env vars cannot be used to mint tokens — that's the whole
// reason we don't use a shared secret here.
const parsePem = (raw) => (raw ? raw.replace(/\\n/g, '\n') : null);
const GATEWAY_PRIVATE_KEY = parsePem(process.env.GATEWAY_PRIVATE_KEY);
const GATEWAY_ISSUER = process.env.GATEWAY_ISSUER || 'apigateway';

const requireProdEnv = () => {
    if (process.env.NODE_ENV !== 'production') return;
    const required = [
        'MONGO_CONN',
        'INTERNAL_AUTH_SECRET',
        'GATEWAY_PRIVATE_KEY',
        'AUTH_SERVER_URL',
        'USERS_SERVICE_URL',
        'AMAZON_SERVICE_URL',
        'WALMART_SERVICE_URL',
        'CORS_ORIGINS'
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
        console.error(`[gateway] FATAL: missing required production env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
};

requireProdEnv();

const requireInternalAuth = (req, res) => {
    const expectedSecret = process.env.INTERNAL_AUTH_SECRET;
    if (!expectedSecret) {
        return res.status(503).json({ success: false, message: 'Internal auth is not configured' });
    }
    if (req.headers['x-internal-auth'] !== expectedSecret) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    return null;
};

// In dev the source-branded checkout pages (Amazon mock at :8000, Walmart mock
// at :8001) call back into this gateway's user API to read carts and place
// orders, so they need to be allowed origins. In prod these would be replaced
// with whatever real domains host the source mocks.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:8000,http://127.0.0.1:8001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);


// ─── Correlation ID middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
    const id = req.headers['x-request-id'] || randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    console.log(`[gateway] [${id}] ${req.method} ${req.originalUrl}`);
    next();
});


// ─── Security headers (helmet) ─────────────────────────────────────────────
// The gateway is the public entry point for the SPA. CSP stays off here
// because the gateway proxies API responses (JSON) — CSP would only matter
// on HTML responses, and the gateway doesn't serve any. The remaining
// helmet defaults (HSTS, X-Content-Type-Options, frame-deny, etc.) are
// still worth applying.
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: isProduction ? undefined : false,
    crossOriginOpenerPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: isProduction ? undefined : false,
    referrerPolicy: { policy: 'same-origin' }
}));


// ─── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    exposedHeaders: ['x-request-id']
}));


// ─── Rate limiting (gateway-wide + extra-strict for auth) ──────────────────
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_PER_15M || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts. Try again later.' }
});

app.use(generalLimiter);
app.use('/api/v1/user/auth/login', authLimiter);
app.use('/api/v1/user/auth/signup', authLimiter);
app.use('/api/v1/user/auth/verifyotp', authLimiter);
app.use('/api/v1/user/admin/login', authLimiter);
app.use('/api/v1/user/recovery', authLimiter);


// Trust-proxy: must NOT be `true` because express-rate-limit (correctly)
// refuses to run if any client can spoof their IP via X-Forwarded-For.
// In local dev we trust loopback only; in prod Render/Heroku put exactly
// one proxy in front, so trust one hop.
//
// This defaulted to 'loopback' in every environment, which meant that in
// production req.ip resolved to the load balancer for EVERY request — so
// express-rate-limit bucketed the entire internet into a single 120/min
// counter and the storefront started 429ing under trivial load. Matches
// Users/ and Amazon/, which already had the production default.
app.set('trust proxy', process.env.TRUST_PROXY || (isProduction ? 1 : 'loopback'));

app.use((req, res, next) => {
    req.headers['x-original-url'] = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    next();
});


// ─── Health endpoint ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'gateway',
        uptime: process.uptime(),
        mongoState: mongoose.connection.readyState,
        upstreams: {
            users: USERS_TARGET,
            amazon: AMAZON_TARGET,
            walmart: WALMART_TARGET
        }
    });
});


// ─── Product token cache + injection ───────────────────────────────────────
const TOKEN_CACHE_TTL_MS = 60 * 1000;
const tokenCache = new Map();

const lookupAccessToken = async (apiName, reqId = '-') => {
    const key = apiName.toLowerCase();
    const cached = tokenCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < TOKEN_CACHE_TTL_MS) {
        console.log(`[gateway] [${reqId}] → Token cache HIT for ${apiName}`);
        return cached.token;
    }
    console.log(`[gateway] [${reqId}] → Token cache MISS for ${apiName} — reading from MongoDB`);
    const cred = await CredsModel.findOne({ api_name: { $regex: new RegExp(`^${apiName}$`, 'i') } });
    if (!cred) {
        console.warn(`[gateway] [${reqId}] ✗ No 'creds' document found for api_name="${apiName}". Run the admin authorization flow first.`);
        return null;
    }
    tokenCache.set(key, { token: cred.access_token, fetchedAt: Date.now() });
    return cred.access_token;
};

// ─── Refresh + retry plumbing ──────────────────────────────────────────────
//
// When an upstream provider (Amazon/Walmart) rejects a request because its
// JWT has expired, the gateway:
//   1. Signs a short-lived assertion JWT with its PRIVATE key (RFC 7523).
//   2. POSTs to the auth server's /auth/token/refresh with the assertion as
//      a Bearer token. The auth server verifies the signature with the
//      matching PUBLIC key — no shared secret on either side.
//   3. Persists the freshly-minted provider JWT to MongoDB.
//   4. Busts the in-memory cache and retries the original request once.
//
// Concurrency: if multiple in-flight requests hit an expired token at the
// same time (Home.js fires Amazon + Walmart in parallel), they share one
// refresh promise per api_name so we don't double-mint tokens.

const refreshesInFlight = new Map();

app.delete('/internal/token-cache/:apiName', (req, res) => {
    const authError = requireInternalAuth(req, res);
    if (authError) return authError;

    const apiName = req.params.apiName;
    if (!apiName) {
        return res.status(400).json({ success: false, message: 'apiName is required' });
    }

    const key = apiName.toLowerCase();
    tokenCache.delete(key);
    refreshesInFlight.delete(key);
    return res.status(200).json({ success: true, message: 'Token cache cleared' });
});

// Sign a brief assertion proving "I'm the gateway, I want a token for
// client_id X, this assertion is single-use within 60 seconds". The auth
// server's TokenRefreshController validates iss/aud/exp/jti.
const signGatewayAssertion = (clientId) => {
    if (!GATEWAY_PRIVATE_KEY) return null;
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        {
            iss: GATEWAY_ISSUER,
            sub: GATEWAY_ISSUER,
            aud: 'auth-server',
            client_id: clientId,
            jti: randomUUID(),
            iat: now,
            exp: now + 60
        },
        GATEWAY_PRIVATE_KEY,
        { algorithm: 'RS256' }
    );
};

// A failed refresh used to be retried on EVERY subsequent product request.
// When the auth server itself is the unhappy party (it rate-limited us, it
// is cold-starting, it is down), that turns a single failure into a
// self-sustaining storm: each request fires another refresh, which keeps the
// budget exhausted, so nothing can ever recover while traffic continues.
// Back off for a fixed window instead and serve the upstream error directly.
const refreshCooldownUntil = new Map();
const REFRESH_COOLDOWN_MS = parseInt(process.env.REFRESH_COOLDOWN_MS || '30000', 10);

const refreshAccessToken = (apiName, reqId = '-') => {
    const key = apiName.toLowerCase();
    if (refreshesInFlight.has(key)) {
        console.log(`[gateway] [${reqId}] ↻ Refresh already in-flight for ${apiName}, awaiting existing promise`);
        return refreshesInFlight.get(key);
    }

    const cooldownUntil = refreshCooldownUntil.get(key);
    if (cooldownUntil && Date.now() < cooldownUntil) {
        const secondsLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
        console.warn(`[gateway] [${reqId}] ⏳ Refresh for ${apiName} is backing off for another ${secondsLeft}s — not retrying`);
        return Promise.resolve(null);
    }

    const promise = (async () => {
        try {
            if (!GATEWAY_PRIVATE_KEY) {
                console.warn(`[gateway] [${reqId}] ✗ Cannot refresh ${apiName}: GATEWAY_PRIVATE_KEY is not set.`);
                return null;
            }
            console.log(`[gateway] [${reqId}] → Looking up credential for ${apiName} in 'creds' collection`);
            const cred = await CredsModel.findOne({ api_name: { $regex: new RegExp(`^${apiName}$`, 'i') } });
            if (!cred || !cred.client_id) {
                console.warn(`[gateway] [${reqId}] ✗ Cannot refresh ${apiName}: no creds row or missing client_id.`);
                return null;
            }
            console.log(`[gateway] [${reqId}] → Found credential client_id=${cred.client_id}`);

            const assertion = signGatewayAssertion(cred.client_id);
            console.log(`[gateway] [${reqId}] → Signed assertion JWT (RS256), POST ${AUTH_SERVER_URL}/auth/token/refresh`);

            const refreshRes = await fetch(`${AUTH_SERVER_URL}/auth/token/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${assertion}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})  // body unused; client_id is in the assertion
            });
            if (!refreshRes.ok) {
                const detail = await refreshRes.text().catch(() => '');
                console.warn(`[gateway] [${reqId}] ✗ Refresh failed for ${apiName}: ${refreshRes.status} ${detail}`);
                return null;
            }
            const data = await refreshRes.json();
            const newToken = data.accessToken;
            if (!newToken) {
                console.warn(`[gateway] [${reqId}] ✗ Refresh response missing accessToken for ${apiName}`);
                return null;
            }

            cred.access_token = newToken;
            await cred.save();
            tokenCache.set(key, { token: newToken, fetchedAt: Date.now() });
            console.log(`[gateway] [${reqId}] ✓ Refresh succeeded for ${apiName} — new token TTL=${data.expiresIn || '?'} — persisted to DB + cache`);
            return newToken;
        } catch (err) {
            console.error(`[gateway] [${reqId}] ✗ Refresh threw for ${apiName}:`, err.message);
            return null;
        }
    })().then((token) => {
        if (token) {
            refreshCooldownUntil.delete(key);
        } else {
            refreshCooldownUntil.set(key, Date.now() + REFRESH_COOLDOWN_MS);
        }
        refreshesInFlight.delete(key);
        return token;
    });

    refreshesInFlight.set(key, promise);
    return promise;
};


// Distinguishes "this token is dead, refreshing might help" from "this
// request is forbidden for some other reason (bad URL, missing header)".
// Amazon's middleware uses 403 for all auth failures, so we have to look at
// the message text.
const isRefreshableFailure = (status, bodyText) => {
    if (status !== 401 && status !== 403) return false;
    const lower = (bodyText || '').toLowerCase();
    return (
        lower.includes('token has expired') ||
        lower.includes('token verification failed') ||
        lower.includes('signature verification failed') ||
        lower.includes('jwt expired')
    );
};


// ─── On-read price snapshotting ─────────────────────────────────────────
//
// After every product-detail request flows through the gateway, we
// snapshot the price into the price_snapshots collection — but ONLY if
// the last snapshot for that product is older than the stale threshold,
// so a popular product doesn't get a row per pageview. The snapshot
// write + alert evaluation are fired-and-forgotten so the buyer's
// response isn't blocked.
//
// The product service returns either { product: {...} } (Amazon's
// controller wraps it) or {...} directly (Walmart's to_json() doesn't),
// so we sniff both shapes.

const SNAPSHOT_STALE_MS = parseInt(process.env.SNAPSHOT_STALE_MS || (6 * 60 * 60 * 1000), 10);
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const extractProduct = (body) => {
    try {
        const parsed = JSON.parse(body);
        const candidate = parsed && parsed.product ? parsed.product : parsed;
        if (candidate &&
            typeof candidate === 'object' &&
            candidate._id &&
            typeof candidate.price === 'number' &&
            typeof candidate.name === 'string') {
            return {
                product_id: String(candidate._id),
                product_name: candidate.name,
                price: candidate.price
            };
        }
    } catch {
        // non-JSON body, list response, or error response — ignore
    }
    return null;
};

const recordPriceAndEvaluateAlerts = async (provider, product, originalUrl, reqId) => {
    try {
        const { product_id, product_name, price } = product;

        // Stale check: skip snapshot if we already have a recent one. Cheap
        // hot-path query — single index hit.
        const last = await PriceSnapshot
            .findOne({ provider, product_id })
            .sort({ snapshotted_at: -1 })
            .select('snapshotted_at');
        const isStale = !last || (Date.now() - last.snapshotted_at.getTime()) > SNAPSHOT_STALE_MS;
        if (!isStale) return;

        await PriceSnapshot.create({ provider, product_id, product_name, price });
        console.log(`[gateway] [${reqId}] 📷 Snapshot — ${provider}/${product_id} @ $${price}`);

        // Find buyers whose threshold was crossed AND who aren't in cooldown.
        // We use last_known_price as the "previous" price for the email body
        // if there's no other reference. After firing, the internal handler
        // updates last_notified_at + last_known_price.
        const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_MS);
        const alerts = await PriceAlert.find({
            provider,
            product_id,
            threshold_price: { $gte: price },
            $or: [
                { last_notified_at: null },
                { last_notified_at: { $lt: cooldownCutoff } }
            ]
        });

        if (alerts.length === 0) return;
        console.log(`[gateway] [${reqId}] 🔔 ${alerts.length} alert(s) triggered for ${provider}/${product_id}`);

        const headers = { 'Content-Type': 'application/json' };
        if (process.env.INTERNAL_AUTH_SECRET) {
            headers['x-internal-auth'] = process.env.INTERNAL_AUTH_SECRET;
        }

        // Fire notifications in parallel. Each call is independent and
        // already idempotent server-side (cooldown re-check), so failures
        // on one alert don't affect the others.
        await Promise.allSettled(alerts.map((alert) =>
            fetch(`${USERS_TARGET}/internal/price-drop`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    alertId: String(alert._id),
                    currentPrice: price,
                    previousPrice: alert.last_known_price,
                    productUrl: originalUrl
                })
            }).then(async (r) => {
                if (!r.ok) {
                    const text = await r.text().catch(() => '');
                    console.warn(`[gateway] [${reqId}] ✗ price-drop notify failed for alert=${alert._id}: ${r.status} ${text.slice(0, 100)}`);
                }
            }).catch((err) => {
                console.warn(`[gateway] [${reqId}] ✗ price-drop notify threw for alert=${alert._id}: ${err.message}`);
            })
        ));
    } catch (err) {
        console.error(`[gateway] [${reqId}] ✗ snapshot/evaluate failed for ${provider}/${product.product_id}:`, err.message);
    }
};


// Standalone upstream product-detail fetch with the same token-refresh
// semantics as proxyProductRoute. Extracted so the GH-Actions-driven
// /internal/snapshot-tracked endpoint can reuse the auth + retry logic
// without faking req/res. Returns a parsed { product_id, product_name,
// price } shape or null on any failure.
const fetchProductDetail = async (apiName, target, productId, reqId = '-') => {
    const upstreamUrl = `${target}/${encodeURIComponent(productId)}`;
    const attempt = async (token) => {
        const headers = { 'x-request-id': reqId };
        if (token) headers['productsauthorization'] = token;
        return fetch(upstreamUrl, { method: 'GET', headers });
    };

    try {
        let token = await lookupAccessToken(apiName, reqId);
        let res = await attempt(token);
        let body = await res.text();

        if (isRefreshableFailure(res.status, body)) {
            const newToken = await refreshAccessToken(apiName, reqId);
            if (newToken) {
                res = await attempt(newToken);
                body = await res.text();
            }
        }

        if (res.status >= 200 && res.status < 300) {
            return extractProduct(body);
        }
        console.warn(`[gateway] [${reqId}] fetchProductDetail ${apiName}/${productId} returned ${res.status}`);
        return null;
    } catch (err) {
        console.warn(`[gateway] [${reqId}] fetchProductDetail ${apiName}/${productId} threw: ${err.message}`);
        return null;
    }
};


// Custom fetch-based proxy for product routes. Replaces http-proxy-middleware
// for these specific paths so we can inspect the response body, decide
// whether to refresh, and retry — none of which the streaming proxy library
// makes easy. User routes (/api/v1/user/*) still use http-proxy-middleware
// since they don't need refresh-on-403 behavior.
const proxyProductRoute = (apiName, provider, target, prefix) => async (req, res) => {
    const upstreamPath = req.originalUrl.startsWith(prefix)
        ? (req.originalUrl.slice(prefix.length) || '/')
        : req.originalUrl;
    const upstreamUrl = `${target}${upstreamPath.startsWith('/') ? upstreamPath : '/' + upstreamPath}`;

    const attempt = async (token) => {
        const headers = {
            'x-original-url': `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            'x-request-id': req.requestId || ''
        };
        if (token) headers['productsauthorization'] = token;
        if (req.headers['accept']) headers['accept'] = req.headers['accept'];
        if (req.headers['cookie']) headers['cookie'] = req.headers['cookie'];
        // Upstream rate limiters see this gateway's egress IP on every
        // proxied call, so without this they bucket every shopper on the
        // internet into one 120/min counter. Pass the real client IP along,
        // authenticated with the shared internal secret so that a caller
        // hitting Amazon/Walmart directly cannot forge a key.
        if (process.env.INTERNAL_AUTH_SECRET && req.ip) {
            headers['x-internal-auth'] = process.env.INTERNAL_AUTH_SECRET;
            headers['x-real-client-ip'] = req.ip;
        }
        return fetch(upstreamUrl, { method: req.method, headers });
    };

    try {
        let token = await lookupAccessToken(apiName, req.requestId);
        if (!token) {
            console.warn(`[gateway] [${req.requestId}] ✗ No token available for ${apiName} — request will likely fail downstream`);
        }
        console.log(`[gateway] [${req.requestId}] → Forwarding ${req.method} to ${upstreamUrl}`);
        let upstreamRes = await attempt(token);
        let body = await upstreamRes.text();
        console.log(`[gateway] [${req.requestId}] ← Upstream responded ${upstreamRes.status}`);

        if (isRefreshableFailure(upstreamRes.status, body)) {
            console.log(`[gateway] [${req.requestId}] ⚠ Upstream JWT rejected for ${apiName} (${upstreamRes.status}) — body excerpt: ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
            console.log(`[gateway] [${req.requestId}] ↻ Triggering refresh flow for ${apiName}`);
            const newToken = await refreshAccessToken(apiName, req.requestId);
            if (newToken) {
                console.log(`[gateway] [${req.requestId}] ↻ Retrying upstream with refreshed token`);
                upstreamRes = await attempt(newToken);
                body = await upstreamRes.text();
                console.log(`[gateway] [${req.requestId}] ← Retry response: ${upstreamRes.status}`);
            } else {
                console.warn(`[gateway] [${req.requestId}] ✗ Refresh did not return a token — passing through original ${upstreamRes.status}`);
            }
        }

        res.status(upstreamRes.status);
        upstreamRes.headers.forEach((value, key) => {
            const lk = key.toLowerCase();
            // Skip hop-by-hop + length headers; Express recomputes content-length.
            if (lk === 'connection' || lk === 'transfer-encoding' || lk === 'content-length' || lk === 'content-encoding') return;
            res.setHeader(key, value);
        });
        res.send(body);

        // Fire-and-forget the snapshot + alert evaluation AFTER responding.
        // Only on 2xx, only on GET, only when the body parses as a single
        // product (skips list responses + error responses automatically).
        if (req.method === 'GET' && upstreamRes.status >= 200 && upstreamRes.status < 300) {
            const product = extractProduct(body);
            if (product) {
                const originalUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
                // Intentionally not awaited — the buyer's response is already sent.
                recordPriceAndEvaluateAlerts(provider, product, originalUrl, req.requestId);
            }
        }
    } catch (err) {
        console.error(`[gateway] [${req.requestId}] Proxy error for ${apiName}:`, err.message);
        res.status(502).json({ message: 'Upstream service unavailable' });
    }
};


// ─── Proxies (versioned at /api/v1) ───────────────────────────────────────
//
// Product routes are read-only by design — TrendyTreasures is an aggregator,
// not a marketplace, so the gateway only forwards GET requests to upstream
// product services. Mutation routes do not exist on Amazon/Walmart services.

const forwardHeaders = (proxyReq, req) => {
    if (req.requestId) proxyReq.setHeader('x-request-id', req.requestId);
    if (req.headers['x-original-url']) proxyReq.setHeader('x-original-url', req.headers['x-original-url']);
    // Same reasoning as the product proxy: Users would otherwise rate-limit
    // every shopper under this gateway's egress IP. Authenticated with the
    // shared secret so it can't be forged by calling Users directly.
    if (process.env.INTERNAL_AUTH_SECRET && req.ip) {
        proxyReq.setHeader('x-internal-auth', process.env.INTERNAL_AUTH_SECRET);
        proxyReq.setHeader('x-real-client-ip', req.ip);
    }
};

app.use('/api/v1/user', createProxyMiddleware({
    target: USERS_TARGET,
    changeOrigin: true,
    pathRewrite: { '^/api/v1/user': '/' },
    onProxyReq: forwardHeaders
}));

// Product routes use the custom proxy (above) so we can refresh + retry on
// expired JWTs. Both methods registered via app.all so future PATCH/POST
// routes don't have to be re-wired here. The `provider` arg ('amazon' /
// 'walmart') is what gets persisted on price_snapshots rows.
const PROVIDER_CONFIG = {
    amazon: { apiName: 'Amazon_Products', target: AMAZON_TARGET, prefix: '/api/v1/amazon/products' },
    walmart: { apiName: 'Walmart', target: WALMART_TARGET, prefix: '/api/v1/walmart/products' }
};
app.all('/api/v1/amazon/products*', proxyProductRoute(PROVIDER_CONFIG.amazon.apiName, 'amazon', PROVIDER_CONFIG.amazon.target, PROVIDER_CONFIG.amazon.prefix));
app.all('/api/v1/walmart/products*', proxyProductRoute(PROVIDER_CONFIG.walmart.apiName, 'walmart', PROVIDER_CONFIG.walmart.target, PROVIDER_CONFIG.walmart.prefix));


// ─── External-cron-driven snapshot of tracked products ─────────────────
//
// On-read snapshotting only captures prices for products buyers actively
// view. Products that have alerts on them but aren't being viewed would
// never trigger a notification on a price drop. This endpoint lets an
// external scheduler (GitHub Actions, Render cron, etc.) sweep ALL
// (provider, product_id) pairs that have at least one alert and snapshot
// their current prices — closing the coverage gap.
//
// Gated by INTERNAL_AUTH_SECRET. Designed to be called every few hours;
// the SNAPSHOT_STALE_MS check inside recordPriceAndEvaluateAlerts means a
// run that's too frequent is harmless (it just skips writes).
app.post('/internal/snapshot-tracked', async (req, res) => {
    const authError = requireInternalAuth(req, res);
    if (authError) return authError;

    try {
        const tracked = await PriceAlert.aggregate([
            { $group: { _id: { provider: '$provider', product_id: '$product_id' } } }
        ]);
        console.log(`[gateway] [${req.requestId}] snapshot-tracked: ${tracked.length} distinct product(s)`);

        const results = [];
        // Sequential — keeps upstream load predictable and respects the
        // existing rate limits Amazon/Walmart enforce on the gateway's
        // own outbound calls. If the tracked-product count ever gets
        // large, swap for a small-concurrency pool.
        for (const { _id: { provider, product_id } } of tracked) {
            const cfg = PROVIDER_CONFIG[provider];
            if (!cfg) {
                results.push({ provider, product_id, status: 'unknown-provider' });
                continue;
            }
            const product = await fetchProductDetail(cfg.apiName, cfg.target, product_id, req.requestId);
            if (!product) {
                results.push({ provider, product_id, status: 'fetch-failed' });
                continue;
            }
            // Original URL is synthesized for the email body's "View on
            // TrendyTreasures" link — the buyer-facing path, not the
            // gateway-internal one.
            const originalUrl = `${req.protocol}://${req.get('host')}${cfg.prefix}/${product_id}`;
            await recordPriceAndEvaluateAlerts(provider, product, originalUrl, req.requestId);
            results.push({ provider, product_id, status: 'ok', price: product.price });
        }

        return res.status(200).json({ success: true, processed: results.length, results });
    } catch (err) {
        console.error(`[gateway] [${req.requestId}] snapshot-tracked failed:`, err.message);
        return res.status(500).json({ success: false, message: 'Snapshot sweep failed' });
    }
});


app.listen(PORT, () => {
    console.log(`[gateway] API Gateway running on port ${PORT}`);
});
