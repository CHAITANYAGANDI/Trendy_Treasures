const jwt = require('jsonwebtoken');


const stripVersion = (path) => path.replace(/^\/api\/v\d+(?=\/)/, '/api');

const matchesApiUrl = (originalUrl, apiUrl) => {
    if (!originalUrl || !apiUrl) return false;
    try {
        const originalPath = stripVersion(new URL(originalUrl).pathname);
        const apiPathRaw = apiUrl.startsWith('http')
            ? new URL(apiUrl).pathname
            : apiUrl;
        const apiPath = stripVersion(apiPathRaw);
        const normalized = apiPath.endsWith('/') ? apiPath.slice(0, -1) : apiPath;
        return originalPath === normalized || originalPath.startsWith(normalized + '/');
    } catch {
        return false;
    }
};


// ─── Active-jti introspection cache ──────────────────────────────────────
//
// The auth server stamps a fresh jti onto the Credential row every time a
// token is minted (re-auth via /auth/authorize OR refresh via
// /auth/token/refresh). We compare it against the jti on the incoming JWT
// to detect superseded tokens — any prior token is implicitly revoked.
//
// Caching the lookup per client_id avoids an HTTP hop on every product
// request. TTL is short so that revocation propagates quickly; tune via
// AUTH_INTROSPECT_CACHE_TTL_MS if needed.

// AUTH_SERVER_URL may be a public host (https://x.onrender.com) or a Render
// internal one (http://auth:10000), with or without a trailing slash — join
// rather than concatenate so neither shape produces a doubled slash.
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:5000';
const authUrl = (path) =>
    `${AUTH_SERVER_URL.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
const INTROSPECT_CACHE_TTL_MS = parseInt(process.env.AUTH_INTROSPECT_CACHE_TTL_MS || '30000', 10);
const jtiCache = new Map();
const inflight = new Map();

const fetchActiveJti = async (clientId, { bustCache = false } = {}) => {
    if (!bustCache) {
        const cached = jtiCache.get(clientId);
        if (cached && Date.now() - cached.fetchedAt < INTROSPECT_CACHE_TTL_MS) {
            return cached.activeJti;
        }
        if (inflight.has(clientId)) {
            return inflight.get(clientId);
        }
    }

    const promise = (async () => {
        try {
            const headers = {};
            if (process.env.INTERNAL_AUTH_SECRET) {
                headers['x-internal-auth'] = process.env.INTERNAL_AUTH_SECRET;
            }
            const res = await fetch(
                authUrl(`/auth/token/active/${encodeURIComponent(clientId)}`),
                { method: 'GET', headers }
            );
            if (!res.ok) {
                console.warn(`[amazon] ✗ Introspection failed for client_id=${clientId}: ${res.status}`);
                return null;
            }
            const data = await res.json();
            const activeJti = data.active_jti || null;
            jtiCache.set(clientId, { activeJti, fetchedAt: Date.now() });
            return activeJti;
        } catch (err) {
            console.warn(`[amazon] ✗ Introspection threw for client_id=${clientId}: ${err.message}`);
            return null;
        } finally {
            if (!bustCache) inflight.delete(clientId);
        }
    })();

    if (!bustCache) inflight.set(clientId, promise);
    return promise;
};


const ensureAuthenticated = async (req, res, next) => {

    const auth = req.headers['productsauthorization'];

    if (!auth || auth === 'null') {
        return res.status(403).json({
            message: "Authorization header is missing or invalid. Please provide a valid token."
        });
    }

    try {

        const decoded = jwt.verify(auth, process.env.SECRET);

        req.products = decoded;

        const originalUrl = req.headers['x-original-url'];

        if (!matchesApiUrl(originalUrl, decoded.api_url)) {
            return res.status(403).json({
                error: 'Invalid API URL. Access denied.',
                originalUrl,
                expectedApiUrl: decoded.api_url
            });
        }

        // Reject tokens that have been superseded by a more recent mint.
        // On mismatch, retry the introspection lookup with cache bypassed —
        // a freshly refreshed token can arrive seconds after our last
        // cached lookup, and we don't want to reject the new token because
        // the cache still holds the old jti.
        //
        // The "Token verification failed" phrasing keeps the gateway's
        // existing isRefreshableFailure() matcher in app.js happy, so the
        // auto-refresh + retry flow kicks in transparently.
        let activeJti = await fetchActiveJti(decoded.client_id);
        if (activeJti && decoded.jti !== activeJti) {
            activeJti = await fetchActiveJti(decoded.client_id, { bustCache: true });
        }
        if (activeJti && decoded.jti !== activeJti) {
            console.warn(`[amazon] ✗ Superseded token — client_id=${decoded.client_id}, jwt.jti=${(decoded.jti || '').slice(0, 8)}…, active=${activeJti.slice(0, 8)}…`);
            return res.status(403).json({
                message: 'Token verification failed: token has been superseded by a newer authorization for this client_id.'
            });
        }

        return next();

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({ message: 'Token has expired' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(403).json({
                message: 'Token signature verification failed. Check that SECRET matches the secret_key used to sign the token in Auth/server.',
                detail: err.message
            });
        }
        return res.status(403).json({ message: 'Token verification failed', detail: err.message });
    }
};

module.exports = ensureAuthenticated;
