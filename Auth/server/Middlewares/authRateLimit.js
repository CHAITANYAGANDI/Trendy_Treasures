// Per-endpoint rate limits for auth-critical routes. These layer on top
// of the global limiter in app.js — the global one stops volumetric
// abuse; these stop targeted brute-force against a single account or
// the OTP/reset mailbox.
//
// For account-bound endpoints we also key on the submitted username/email
// so an attacker can't dodge by rotating IPs.
//
// The IP portion comes from the portable resolver in
// Middlewares/clientIdentity.js, not from a single hard-coded header. It
// trusts, in order: an authenticated x-real-client-ip from our own gateway,
// a platform edge header only where the deployment declares one, then
// req.ip from an explicit trust-proxy hop count. Reading a caller-supplied
// header unconditionally would be a free rate-limit bypass on a platform
// that doesn't strip it.
//
// We route the IP portion of every key through `ipKeyGenerator` so IPv6
// subnet normalization is applied (/56 by default) — otherwise an attacker
// on IPv6 could just walk the low bits to dodge per-IP limits.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { clientIdentityKey } = require('./clientIdentity');

// `ipKeyGenerator` takes an IP *string*. It used to be called here as
// `ipKeyGenerator(req, res)`, which returned the request object unchanged
// (it only rewrites IPv6 strings) — and MemoryStore keys a Map by identity,
// so every request got its own bucket and these limiters never fired. The
// account-bound keys below interpolated that object into a template, which
// stringifies to a constant, so they silently keyed on the username alone.
const ipKey = (req) => clientIdentityKey(req, { normalize: (ip) => ipKeyGenerator(ip) });

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
