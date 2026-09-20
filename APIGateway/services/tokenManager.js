'use strict';

// ─── Provider access-token lifecycle ───────────────────────────────────────
//
// Amazon and Walmart accept a `productsauthorization` JWT that the auth
// server mints (CLIENT_TOKEN_TTL, 30d by default). Historically the gateway
// only noticed a dead token when a provider rejected it:
//
//     shopper → expired JWT → provider 403 → refresh → retry
//
// which makes every token expiry a user-visible outage, and turns any auth
// server hiccup into an empty catalogue. This module moves the check in
// front of the provider call: decode `exp`, refresh before it lapses, and
// keep the reactive path as a backstop for revoked/superseded tokens.
//
// Everything here is dependency-injected (model, fetch, clock, sleep, RNG)
// so the lifecycle can be tested without Mongo, a network, or real timers.
// app.js owns the wiring; this file owns the policy.

const jwt = require('jsonwebtoken');

// Worth retrying: the auth server is busy, restarting, or unreachable.
// Everything else (400/401/403/404, and 500 "Failed to refresh token") means
// the request itself is wrong — retrying just burns the shopper's latency
// budget. Those still recover on the next request once the cooldown lapses.
const TRANSIENT_REFRESH_STATUSES = new Set([429, 502, 503, 504]);

const REFRESH_PATH = '/auth/token/refresh';

const intFromEnv = (raw, fallback) => {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Join without doubling or dropping slashes, so an internal Render host
// (`http://auth:10000`) and a public one (`https://x.onrender.com/`) both
// produce a valid URL.
const joinUrl = (base, path) =>
    `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;

// `jwt.decode` does not verify — that's deliberate and safe here. The gateway
// is not the party that validates these tokens (Amazon/Walmart verify the
// HS256 signature against their own SECRET); it only needs `exp` to decide
// when to renew. A forged token would fail downstream regardless.
const decodeExpSeconds = (token) => {
    if (typeof token !== 'string' || token.length === 0) return null;
    try {
        const decoded = jwt.decode(token);
        if (!decoded || typeof decoded !== 'object') return null;
        return Number.isFinite(decoded.exp) ? decoded.exp : null;
    } catch {
        return null;
    }
};

/**
 * Decide whether a provider token needs renewing.
 * Refreshes when the token is missing, undecodable, has no `exp`, has
 * expired, or falls inside the refresh-ahead window.
 */
const shouldRefreshToken = (token, { refreshAheadSeconds = 300, now = Date.now() } = {}) => {
    if (typeof token !== 'string' || token.length === 0) {
        return { refresh: true, reason: 'missing', expired: true, expiresInSeconds: null };
    }
    const exp = decodeExpSeconds(token);
    if (exp === null) {
        // No `exp` claim, or not a JWT at all. Treat as unusable rather than
        // assuming it lives forever.
        return { refresh: true, reason: 'undecodable', expired: true, expiresInSeconds: null };
    }
    const expiresInSeconds = Math.round((exp * 1000 - now) / 1000);
    if (expiresInSeconds <= 0) {
        return { refresh: true, reason: 'expired', expired: true, expiresInSeconds };
    }
    if (expiresInSeconds <= refreshAheadSeconds) {
        return { refresh: true, reason: 'near-expiry', expired: false, expiresInSeconds };
    }
    return { refresh: false, reason: 'valid', expired: false, expiresInSeconds };
};

/**
 * RFC 7231 Retry-After: delta-seconds or an HTTP-date. Returns ms, or null
 * when the header is absent/unparseable.
 */
const parseRetryAfter = (raw, now = Date.now()) => {
    if (raw === null || raw === undefined) return null;
    const value = String(raw).trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    const when = Date.parse(value);
    if (Number.isFinite(when)) return Math.max(0, when - now);
    return null;
};

// Exponential backoff with jitter: ~1s, ~2s, ~4s, each up to +50%. Jitter
// keeps Amazon's and Walmart's retry schedules from locking in step.
const backoffDelayMs = (attempt, maxDelayMs, random = Math.random) => {
    const base = 1000 * 2 ** (attempt - 1);
    return Math.min(Math.round(base + base * 0.5 * random()), maxDelayMs);
};

const createTokenManager = ({
    CredsModel,
    signAssertion,
    authServerUrl,
    fetchImpl = (...args) => globalThis.fetch(...args),
    logger = console,
    env = process.env,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random
} = {}) => {
    const config = {
        refreshAheadSeconds: intFromEnv(env.TOKEN_REFRESH_AHEAD_SECONDS, 300),
        maxAttempts: Math.max(1, intFromEnv(env.REFRESH_MAX_ATTEMPTS, 3)),
        requestTimeoutMs: intFromEnv(env.REFRESH_REQUEST_TIMEOUT_MS, 10000),
        maxRetryDelayMs: intFromEnv(env.REFRESH_MAX_RETRY_DELAY_MS, 30000),
        cooldownMs: intFromEnv(env.REFRESH_COOLDOWN_MS, 30000),
        cacheTtlMs: intFromEnv(env.TOKEN_CACHE_TTL_MS, 60000)
    };

    const tokenCache = new Map();          // key → { token, fetchedAt }
    const refreshesInFlight = new Map();   // key → Promise<string|null>
    const refreshCooldownUntil = new Map();// key → epoch ms

    const keyOf = (apiName) => String(apiName).toLowerCase();
    const log = (reqId, msg) => logger.log(`[gateway] [${reqId}] ${msg}`);
    const warn = (reqId, msg) => logger.warn(`[gateway] [${reqId}] ${msg}`);

    const loadCredential = (apiName) =>
        CredsModel.findOne({ api_name: { $regex: new RegExp(`^${escapeRegex(apiName)}$`, 'i') } });

    // One HTTP attempt against the auth server, bounded by AbortController so
    // a hung auth service can't pin a shopper request open indefinitely.
    const callAuthRefresh = async (clientId, reqId) => {
        const assertion = signAssertion(clientId);
        if (!assertion) {
            return { ok: false, permanent: true, status: 0, reason: 'GATEWAY_PRIVATE_KEY is not set' };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        try {
            const res = await fetchImpl(joinUrl(authServerUrl, REFRESH_PATH), {
                method: 'POST',
                headers: {
                    // Assertion is a bearer credential — never logged.
                    Authorization: `Bearer ${assertion}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({}), // client_id travels in the assertion
                signal: controller.signal
            });

            if (res.ok) {
                const data = await res.json().catch(() => null);
                const token = data && data.accessToken;
                if (!token) {
                    return { ok: false, permanent: true, status: res.status, reason: 'response missing accessToken' };
                }
                return { ok: true, token, expiresIn: data.expiresIn };
            }

            const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now());
            // Read the body for diagnostics only. It never contains token
            // material on a failure path, and we truncate regardless.
            const detail = await res.text().catch(() => '');
            return {
                ok: false,
                permanent: !TRANSIENT_REFRESH_STATUSES.has(res.status),
                status: res.status,
                retryAfterMs,
                reason: detail.slice(0, 200).replace(/\s+/g, ' ')
            };
        } catch (err) {
            // Abort (timeout) and network errors are both worth retrying.
            const timedOut = err && err.name === 'AbortError';
            return {
                ok: false,
                permanent: false,
                status: 0,
                reason: timedOut ? `timed out after ${config.requestTimeoutMs}ms` : `network error: ${err.message}`
            };
        } finally {
            clearTimeout(timer);
        }
    };

    // Full refresh cycle for one provider: load credential, retry transient
    // failures with backoff, persist + cache on success.
    const performRefresh = async (apiName, reqId) => {
        const key = keyOf(apiName);

        let cred;
        try {
            cred = await loadCredential(apiName);
        } catch (err) {
            warn(reqId, `✗ credential lookup failed for ${apiName}: ${err.message}`);
            refreshCooldownUntil.set(key, now() + config.cooldownMs);
            return null;
        }

        if (!cred || !cred.client_id) {
            warn(reqId, `✗ ${apiName} is not provisioned — no credential document (or it has no client_id). Run the admin authorization flow.`);
            refreshCooldownUntil.set(key, now() + config.cooldownMs);
            return null;
        }

        for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
            log(reqId, `refresh attempt ${attempt}/${config.maxAttempts} for ${apiName}`);
            const outcome = await callAuthRefresh(cred.client_id, reqId);

            if (outcome.ok) {
                const exp = decodeExpSeconds(outcome.token);
                cred.access_token = outcome.token;
                if (exp !== null) cred.token_expires_at = new Date(exp * 1000);
                cred.refreshed_at = new Date(now());
                try {
                    await cred.save();
                } catch (err) {
                    // The token is good even if persistence failed; cache it
                    // so this instance keeps serving, and surface the problem.
                    warn(reqId, `⚠ refreshed ${apiName} but could not persist to MongoDB: ${err.message}`);
                }
                tokenCache.set(key, { token: outcome.token, fetchedAt: now() });
                refreshCooldownUntil.delete(key);
                log(reqId, `refresh succeeded for ${apiName}; expires_at=${exp !== null ? new Date(exp * 1000).toISOString() : 'unknown'}`);
                return outcome.token;
            }

            if (outcome.permanent) {
                warn(reqId, `refresh permanently failed for ${apiName} status=${outcome.status} (${outcome.reason}) — not retrying`);
                break;
            }

            if (attempt < config.maxAttempts) {
                const delay = Math.min(
                    outcome.retryAfterMs !== null && outcome.retryAfterMs !== undefined
                        ? outcome.retryAfterMs
                        : backoffDelayMs(attempt, config.maxRetryDelayMs, random),
                    config.maxRetryDelayMs
                );
                log(reqId, `refresh returned ${outcome.status || 'no response'} for ${apiName}; retrying in ${delay}ms`);
                await sleep(delay);
            } else {
                warn(reqId, `provider token refresh exhausted after ${config.maxAttempts} attempts for ${apiName} (last status=${outcome.status || 'no response'})`);
            }
        }

        refreshCooldownUntil.set(key, Math.max(refreshCooldownUntil.get(key) || 0, now() + config.cooldownMs));
        return null;
    };

    // Single-flight: 20 concurrent shopper requests produce exactly one
    // refresh per provider. Amazon and Walmart key independently.
    const refresh = (apiName, reqId) => {
        const key = keyOf(apiName);

        const existing = refreshesInFlight.get(key);
        if (existing) {
            log(reqId, `refresh already in flight for ${apiName} — awaiting it`);
            return existing;
        }

        // The cooldown applies to the reactive path too. A provider insisting
        // the token is bad is not a reason to keep hammering an auth service
        // that just told us it can't help.
        const until = refreshCooldownUntil.get(key);
        if (until && now() < until) {
            warn(reqId, `refresh for ${apiName} backing off for another ${Math.ceil((until - now()) / 1000)}s — not retrying`);
            return Promise.resolve(null);
        }

        const promise = performRefresh(apiName, reqId).finally(() => {
            refreshesInFlight.delete(key);
        });
        refreshesInFlight.set(key, promise);
        return promise;
    };

    /**
     * The token to send to a provider, renewing first when needed.
     * → { status: 'ok', token }        usable token
     * → { status: 'not_provisioned' }  no credential document at all
     * → { status: 'unavailable' }      token dead and refresh failed
     */
    const getAccessToken = async (apiName, reqId) => {
        const key = keyOf(apiName);
        const opts = { refreshAheadSeconds: config.refreshAheadSeconds, now: now() };

        const cached = tokenCache.get(key);
        if (cached) {
            const verdict = shouldRefreshToken(cached.token, opts);
            if (!verdict.refresh && now() - cached.fetchedAt < config.cacheTtlMs) {
                return { status: 'ok', token: cached.token };
            }
            // A refresh is already running and this token is still valid —
            // serve it instead of re-reading Mongo on every request.
            if (!verdict.expired && refreshesInFlight.has(key)) {
                return { status: 'ok', token: cached.token };
            }
        }

        let cred;
        try {
            cred = await loadCredential(apiName);
        } catch (err) {
            warn(reqId, `✗ credential lookup failed for ${apiName}: ${err.message}`);
            return { status: 'unavailable' };
        }

        if (!cred || !cred.access_token) {
            warn(reqId, `✗ ${apiName} is not provisioned — no credential document. Run the admin authorization flow.`);
            return { status: 'not_provisioned' };
        }

        const verdict = shouldRefreshToken(cred.access_token, opts);
        if (!verdict.refresh) {
            tokenCache.set(key, { token: cred.access_token, fetchedAt: now() });
            return { status: 'ok', token: cred.access_token };
        }

        log(
            reqId,
            `token ${apiName} ${verdict.reason === 'near-expiry'
                ? `expires in ${verdict.expiresInSeconds}s`
                : `is ${verdict.reason}`} — proactive refresh required`
        );

        // Still valid, just inside the window: renew in the background and
        // serve the current token now. Blocking here would add auth-server
        // latency to a request that has a perfectly good token in hand.
        if (!verdict.expired) {
            tokenCache.set(key, { token: cred.access_token, fetchedAt: now() });
            const pending = refresh(apiName, reqId);
            if (pending && typeof pending.catch === 'function') {
                pending.catch((err) => warn(reqId, `background refresh for ${apiName} threw: ${err.message}`));
            }
            return { status: 'ok', token: cred.access_token, refreshing: true };
        }

        // Expired or undecodable — nothing safe to serve, so wait for it.
        const token = await refresh(apiName, reqId);
        if (token) return { status: 'ok', token };

        tokenCache.delete(key);
        return { status: 'unavailable' };
    };

    /**
     * Reactive path: a provider rejected the token we just sent. Drop the
     * cached copy and force one refresh. The caller retries exactly once.
     */
    const refreshAfterRejection = async (apiName, reqId) => {
        tokenCache.delete(keyOf(apiName));
        return refresh(apiName, reqId);
    };

    return {
        config,
        getAccessToken,
        refreshAfterRejection,
        // Exposed for the admin cache-bust endpoint and for tests.
        invalidate: (apiName) => {
            const key = keyOf(apiName);
            tokenCache.delete(key);
            refreshesInFlight.delete(key);
            refreshCooldownUntil.delete(key);
        }
    };
};

module.exports = {
    createTokenManager,
    shouldRefreshToken,
    parseRetryAfter,
    backoffDelayMs,
    decodeExpSeconds,
    joinUrl,
    TRANSIENT_REFRESH_STATUSES
};
