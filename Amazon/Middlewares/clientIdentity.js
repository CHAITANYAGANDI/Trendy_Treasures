'use strict';

// ─── Portable client identity + proxy trust ────────────────────────────────
//
// SYNCHRONISED COPY — an identical file lives at:
//   APIGateway/middleware/clientIdentity.js
//   Users/Middlewares/clientIdentity.js
//   Amazon/Middlewares/clientIdentity.js
//   Auth/server/Middlewares/clientIdentity.js
// with a Python port at Walmart/Middlewares/client_identity.py
//
// It is duplicated rather than shared because `gcloud run deploy --source
// ./Users` uploads only that one directory — a require() reaching above the
// service root would not exist in the build context. Keep the copies in step.
//
//
// WHY THIS EXISTS
//
// Rate limiting is only as good as its answer to "who is this caller".
// Get it wrong in one direction and every shopper shares a single bucket
// (a self-inflicted denial of service). Get it wrong in the other and any
// caller mints a fresh bucket per request just by setting a header.
//
// The previous implementation read `CF-Connecting-IP` unconditionally,
// because Render serves *.onrender.com through Cloudflare, which sets that
// header and overwrites whatever the caller sent. That reasoning does not
// transfer: on a platform with no Cloudflare in front — Cloud Run — nothing
// strips the header, so it is entirely caller-controlled and trusting it is
// a free rate-limit bypass. Hence an edge header is honoured only when the
// deployment explicitly declares an edge that is known to set it.
//
//
// TRUST ORDER
//
// 1. `x-real-client-ip`, but only when `x-internal-auth` timing-safe matches
//    INTERNAL_AUTH_SECRET. Only our own gateway sends that pair. Required
//    because gateway-proxied traffic all arrives from one egress address, so
//    keying on the socket address would merge every shopper into one bucket.
// 2. A declared platform edge header (Cloudflare's CF-Connecting-IP on
//    Render) — opt-in per platform, never by default.
// 3. `req.ip`, as Express resolves it from an EXPLICIT trust-proxy hop count.
//    This is the platform's own forwarded address.
//
// An unauthenticated caller-supplied header is never trusted at any step.

const { timingSafeEqual } = require('crypto');

// trustProxy   — how many proxy hops in front of the app may be trusted to
//                have written X-Forwarded-For.
// edgeIpHeader — a header the edge both sets AND overwrites, so a caller
//                cannot forge it. `null` means "trust no client header".
const PLATFORM_PRESETS = {
    // Cloud Run places exactly one Google-managed front end in front of the
    // container, and it controls the final X-Forwarded-For entry. Trusting
    // one hop therefore resolves req.ip to the real caller, whether or not
    // the caller tried to prepend their own values. No edge header is
    // trusted: nothing here would strip a forged CF-Connecting-IP.
    'cloud-run': { trustProxy: 1, edgeIpHeader: null },

    // Render serves *.onrender.com through Cloudflare and then its own
    // router — two hops. Cloudflare sets and overwrites CF-Connecting-IP.
    render: { trustProxy: 2, edgeIpHeader: 'cf-connecting-ip' },

    // Direct connections. Trust nothing beyond loopback.
    local: { trustProxy: 'loopback', edgeIpHeader: null }
};

const PLATFORM_ALIASES = {
    cloudrun: 'cloud-run',
    'google-cloud-run': 'cloud-run',
    gcp: 'cloud-run'
};

/**
 * Resolve the deployment platform name.
 *
 * The production default is `cloud-run` because it is the conservative
 * choice: it trusts one hop and no caller headers. If that default is wrong
 * for a Render deployment the failure mode is coarser rate-limit buckets —
 * annoying, not exploitable. Defaulting the other way would trust a
 * forgeable header on Cloud Run, which is exploitable. Render deployments
 * must therefore set DEPLOYMENT_PLATFORM=render explicitly.
 */
const resolvePlatform = (env = process.env) => {
    const fallback = env.NODE_ENV === 'production' ? 'cloud-run' : 'local';
    const raw = String(env.DEPLOYMENT_PLATFORM || '').trim().toLowerCase();
    if (!raw) return fallback;
    const name = PLATFORM_ALIASES[raw] || raw;
    if (PLATFORM_PRESETS[name]) return name;
    // Unrecognised value: fail safe rather than guess.
    // eslint-disable-next-line no-console
    console.warn(
        `[clientIdentity] unknown DEPLOYMENT_PLATFORM="${raw}" — using "${fallback}"`
    );
    return fallback;
};

const platformPreset = (env = process.env) => PLATFORM_PRESETS[resolvePlatform(env)];

/**
 * Value for Express's `trust proxy`.
 *
 * TRUST_PROXY overrides the preset for topologies without a name here (an
 * extra load balancer, a service mesh). `true` is refused: it trusts the
 * left-most X-Forwarded-For entry, which any caller can write, and
 * express-rate-limit rightly refuses to run with it.
 */
const trustProxySetting = (env = process.env) => {
    const preset = platformPreset(env).trustProxy;
    const override = env.TRUST_PROXY;
    if (override === undefined || String(override).trim() === '') return preset;

    const raw = String(override).trim();
    if (raw.toLowerCase() === 'true') {
        // eslint-disable-next-line no-console
        console.warn(
            '[clientIdentity] TRUST_PROXY=true is unsafe — any caller could spoof ' +
            `X-Forwarded-For. Ignoring it and using the ${resolvePlatform(env)} preset.`
        );
        return preset;
    }
    if (/^\d+$/.test(raw)) return Number(raw);
    // 'loopback', a CIDR, or a comma-separated list — Express parses these.
    return raw;
};

const timingSafeEq = (a, b) => {
    const left = Buffer.from(String(a === undefined || a === null ? '' : a));
    const right = Buffer.from(String(b === undefined || b === null ? '' : b));
    return left.length === right.length && timingSafeEqual(left, right);
};

/** True only when the request carries our own gateway's shared secret. */
const hasInternalAuth = (req, env = process.env) => {
    const secret = env.INTERNAL_AUTH_SECRET;
    const provided = req.headers && req.headers['x-internal-auth'];
    if (!secret || !provided) return false;
    try {
        return timingSafeEq(provided, secret);
    } catch {
        return false;
    }
};

/**
 * Collapse an IPv6 address to its /64 prefix. A residential IPv6 allocation
 * is usually a /64 or larger, so without this a caller walks the low bits
 * for a fresh bucket per request. IPv4 is returned unchanged.
 */
const normalizeIp = (ip) => {
    const raw = String(ip || 'unknown');
    if (!raw.includes(':')) return raw;
    return `${raw.split(':').slice(0, 4).join(':')}::/64`;
};

/**
 * The address to treat as the caller.
 *
 * `trustGatewayHeader` must be false on the API gateway itself: it is the
 * public entry point and has no upstream of its own whose headers it should
 * believe.
 */
const resolveClientIp = (req, { env = process.env, trustGatewayHeader = true } = {}) => {
    if (trustGatewayHeader && hasInternalAuth(req, env)) {
        const forwarded = req.headers['x-real-client-ip'];
        if (forwarded) return { ip: String(forwarded), source: 'gateway' };
    }

    const { edgeIpHeader } = platformPreset(env);
    if (edgeIpHeader) {
        const edgeIp = req.headers && req.headers[edgeIpHeader];
        if (edgeIp) return { ip: String(edgeIp), source: 'edge' };
    }

    return { ip: (req.ip || 'unknown'), source: 'socket' };
};

/**
 * Rate-limit key for the caller.
 *
 * Gateway-forwarded identities are namespaced under `gw:` so a caller
 * reaching a service directly can never land in a proxied shopper's bucket,
 * even if they somehow present the same address.
 *
 * `normalize` lets each service keep its own IPv6 subnet behaviour —
 * express-rate-limit v8 services pass `ipKeyGenerator`, v7 services use the
 * /64 default above.
 */
const clientIdentityKey = (req, options = {}) => {
    const { normalize = normalizeIp } = options;
    const { ip, source } = resolveClientIp(req, options);
    const key = normalize(ip) || 'unknown';
    return source === 'gateway' ? `gw:${key}` : key;
};

/** One-line startup summary so a misconfiguration is visible in the logs. */
const describePlatform = (env = process.env) => {
    const name = resolvePlatform(env);
    const { edgeIpHeader } = PLATFORM_PRESETS[name];
    return (
        `platform=${name} trustProxy=${String(trustProxySetting(env))} ` +
        `edgeHeader=${edgeIpHeader || 'none'}`
    );
};

module.exports = {
    PLATFORM_PRESETS,
    resolvePlatform,
    platformPreset,
    trustProxySetting,
    hasInternalAuth,
    normalizeIp,
    resolveClientIp,
    clientIdentityKey,
    describePlatform
};
