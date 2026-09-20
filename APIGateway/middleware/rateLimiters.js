'use strict';

// ─── Gateway rate limiting ─────────────────────────────────────────────────
//
// Three budgets, deliberately non-overlapping:
//
//   authLimiter       login / signup / OTP / admin-login / recovery
//   csrfTokenLimiter  the SPA's one-shot CSRF bootstrap
//   generalLimiter    everything else
//
// The important property is that they do NOT stack. Auth routes used to be
// billed to the general bucket *and* the auth bucket, so ordinary browsing
// (product lists, /auth/me on every navigation, cart reads) could exhaust
// the 120/min general budget and lock a shopper out of signing in — a
// self-inflicted denial of service on the one action that recovers the
// session. The dedicated budgets are tighter than the general one, so
// skipping the general limiter for those paths weakens nothing.
//
// Lives in its own module so the policy can be tested against a real
// express app without booting app.js (which listens and opens Mongo).

const rateLimit = require('express-rate-limit');

const AUTH_LIMITED_PATHS = [
    '/api/v1/user/auth/login',
    '/api/v1/user/auth/signup',
    '/api/v1/user/auth/verifyotp',
    '/api/v1/user/admin/login',
    '/api/v1/user/recovery'
];

const CSRF_TOKEN_PATH = '/api/v1/user/csrf-token';

// Collapse an IPv6 address to its /64 prefix. A single residential IPv6
// allocation is usually a /64 or larger, so without this an attacker just
// walks the low bits to get a fresh bucket per request. express-rate-limit
// ships an `ipKeyGenerator` helper that does this, but it isn't exported by
// the v7 line pinned here, so it's inlined.
const normalizeIp = (ip) => {
    const raw = String(ip || 'unknown');
    if (!raw.includes(':')) return raw;
    return `${raw.split(':').slice(0, 4).join(':')}::/64`;
};

// Render fronts every *.onrender.com host with Cloudflare, so a request
// crosses two proxy layers and any fixed `trust proxy` hop count resolves
// req.ip to a proxy address from a rotating pool. Cloudflare sets
// CF-Connecting-IP to the true client address and overwrites whatever the
// caller sent, so behind Render it is both accurate and unspoofable.
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

const clientIpKey = (req) => normalizeIp(clientIp(req));

// Mirrors Express's own mount semantics: exact match, or a deeper path.
const pathMatches = (reqPath, base) => reqPath === base || reqPath.startsWith(`${base}/`);

const isHealthRoute = (req) => req.path === '/health';

const hasDedicatedLimiter = (req) =>
    pathMatches(req.path, CSRF_TOKEN_PATH) ||
    AUTH_LIMITED_PATHS.some((base) => pathMatches(req.path, base));

const skipGeneralLimiter = (req) =>
    // CORS preflights are browser-generated, carry no credentials and do no
    // work. Counting them halved every shopper's effective budget.
    req.method === 'OPTIONS' ||
    // Render pings /health on a schedule and uptime monitors pile on.
    isHealthRoute(req) ||
    hasDedicatedLimiter(req);

// `/api/v1/user/auth/google` is reached by submitting a GET form, so the
// browser is *navigating* — there is no JS waiting to read a JSON body, and
// answering with JSON strands the user on a raw error page.
//
// Identify that positively via Fetch Metadata rather than by ruling out
// `cors`: a *same-origin* fetch sends `Sec-Fetch-Mode: same-origin`, so a
// "not cors" test would misread it as a navigation and answer an XHR with a
// redirect. Accept-header sniffing is only the fallback for clients that
// don't send Sec-Fetch-Mode at all.
const isBrowserNavigation = (req) => {
    if (req.method !== 'GET') return false;
    const mode = req.headers['sec-fetch-mode'];
    if (mode) return mode === 'navigate';
    return String(req.headers.accept || '').includes('text/html');
};

const intFromEnv = (raw, fallback) => {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createRateLimiters = ({
    env = process.env,
    storefrontUrl = '',
    logger = console
} = {}) => {
    const base = { standardHeaders: true, legacyHeaders: false, keyGenerator: clientIpKey };

    // Named so the log says which budget ran out. Without that, a 429 in
    // production is indistinguishable between "this shopper browsed a lot"
    // and "this shopper is brute-forcing a password" — opposite problems
    // needing opposite responses.
    const onLimitExceeded = (limiterName) => (req, res, next, options) => {
        logger.warn(
            `[gateway] [${req.requestId || '-'}] ✗ ${limiterName} rejected ` +
            `${req.method} ${req.path} ip=${clientIpKey(req)}`
        );
        // Answering a navigation with JSON strands the user on a raw error
        // page. Every other sign-in failure redirects to /login?error=<code>;
        // a throttled one short-circuits before that router runs, so do it here.
        if (storefrontUrl && isBrowserNavigation(req)) {
            return res.redirect(`${storefrontUrl}/login?error=rate_limited`);
        }
        return res.status(options.statusCode).send(options.message);
    };

    const generalLimiter = rateLimit({
        ...base,
        windowMs: 60 * 1000,
        max: intFromEnv(env.RATE_LIMIT_PER_MIN, 120),
        skip: skipGeneralLimiter,
        handler: onLimitExceeded('generalLimiter'),
        message: { error: 'Too many requests, slow down.' }
    });

    const authLimiter = rateLimit({
        ...base,
        windowMs: 15 * 60 * 1000,
        max: intFromEnv(env.AUTH_RATE_LIMIT_PER_15M, 30),
        handler: onLimitExceeded('authLimiter'),
        message: { error: 'Too many auth attempts. Try again later.' }
    });

    // One bootstrap per session is normal; a few more across tabs and
    // reloads is still normal. This only has to stop the endpoint being used
    // as a free unmetered proxy into the Users service.
    const csrfTokenLimiter = rateLimit({
        ...base,
        windowMs: 60 * 1000,
        max: intFromEnv(env.CSRF_RATE_LIMIT_PER_MIN, 60),
        handler: onLimitExceeded('csrfTokenLimiter'),
        message: { error: 'Too many requests, slow down.' }
    });

    return { generalLimiter, authLimiter, csrfTokenLimiter };
};

// Dedicated limiters first, then the general one (which skips their paths).
const installRateLimiters = (app, opts) => {
    const limiters = createRateLimiters(opts);
    app.use(CSRF_TOKEN_PATH, limiters.csrfTokenLimiter);
    app.use(AUTH_LIMITED_PATHS, limiters.authLimiter);
    app.use(limiters.generalLimiter);
    return limiters;
};

module.exports = {
    installRateLimiters,
    createRateLimiters,
    clientIp,
    clientIpKey,
    normalizeIp,
    skipGeneralLimiter,
    isBrowserNavigation,
    AUTH_LIMITED_PATHS,
    CSRF_TOKEN_PATH
};
