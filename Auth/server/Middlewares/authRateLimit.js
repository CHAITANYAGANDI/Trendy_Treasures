// Per-endpoint rate limits for auth-critical routes. These layer on top
// of the global limiter in app.js — the global one stops volumetric
// abuse; these stop targeted brute-force against a single account or
// the OTP/reset mailbox.
//
// For account-bound endpoints we also key on the submitted username/email
// so an attacker can't dodge by rotating IPs.
//
// The IP portion comes from CF-Connecting-IP rather than req.ip. Render
// fronts *.onrender.com with Cloudflare, so a request crosses two proxy
// layers and any fixed `trust proxy` hop count resolves req.ip to a proxy
// address from a shared pool — which both lumps unrelated users into one
// bucket and lets an attacker ride a bucket they don't own. Cloudflare
// overwrites CF-Connecting-IP, so it can't be forged from outside.
//
// We route the IP portion of every key through `ipKeyGenerator` so IPv6
// subnet normalization is applied (/56 by default) — otherwise an attacker
// on IPv6 could just walk the low bits to dodge per-IP limits.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// `ipKeyGenerator` takes an IP *string*. It used to be called here as
// `ipKeyGenerator(req, res)`, which returned the request object unchanged
// (it only rewrites IPv6 strings) — and MemoryStore keys a Map by identity,
// so every request got its own bucket and these limiters never fired. The
// account-bound keys below interpolated that object into a template, which
// stringifies to a constant, so they silently keyed on the username alone.
const ipKey = (req) => ipKeyGenerator(req.headers['cf-connecting-ip'] || req.ip);

const ipAndBodyKey = (field) => (req) => {
    const ip = ipKey(req);
    const v = String((req.body && req.body[field]) || '').toLowerCase().trim();
    return `${ip}|${v}`;
};

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndBodyKey('username'),
    message: { success: false, message: 'Too many login attempts. Try again later.' }
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndBodyKey('email'),
    message: { success: false, message: 'Too many reset requests. Try again later.' }
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndBodyKey('email'),
    message: { success: false, message: 'Too many reset attempts. Try again later.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKey,
    message: { success: false, message: 'Too many signups from this IP. Try again later.' }
});

// /register/verify — the verifySignupOtp middleware enforces a 5-attempt
// counter on the OTP record itself, but that only stops brute-force against
// a single live code. This IP-keyed limiter caps how many distinct verify
// attempts a host can make per window, blunting credential-stuffing-style
// abuse where the attacker burns through many pending signups in parallel.
const registerVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKey,
    message: { success: false, message: 'Too many verification attempts. Try again later.' }
});

const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKey,
    message: { success: false, message: 'Too many refresh requests. Try again later.' }
});

module.exports = {
    ipKey,
    loginLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
    registerLimiter,
    registerVerifyLimiter,
    refreshLimiter
};
