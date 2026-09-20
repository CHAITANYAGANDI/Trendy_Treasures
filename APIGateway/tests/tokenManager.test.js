'use strict';

// Run with:  npm test          (from APIGateway/)
//            node --test tests/
//
// Uses node:test rather than jest: the gateway has no test framework or
// devDependencies today, and node:test ships with Node 18+, so this adds
// coverage without pulling a toolchain into a deploy image. Auth/server/
// keeps its jest suite — this doesn't change it.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
    createTokenManager,
    shouldRefreshToken,
    parseRetryAfter,
    joinUrl
} = require('../services/tokenManager');

const SECRET = 'test-only-not-a-real-secret';

// A provider-shaped JWT expiring `seconds` from the harness clock. `label`
// keeps otherwise-identical payloads distinguishable — two tokens signed
// from the same claims are byte-identical, which would mask a bug where
// providers share a cache key.
let tokenSeq = 0;
const tokenExpiringIn = (seconds, nowMs, label) =>
    jwt.sign(
        {
            client_id: 'c1',
            api_name: 'Amazon_Products',
            label: label || `t${(tokenSeq += 1)}`,
            exp: Math.floor(nowMs / 1000) + seconds
        },
        SECRET
    );

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};

const jsonResponse = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
});

// Minimal mongoose-document stand-in.
const makeCred = (overrides = {}) => ({
    client_id: 'c1',
    api_name: 'Amazon_Products',
    api_url: 'https://amazon.test/api/amazon/products',
    access_token: 'seed',
    saved: 0,
    async save() { this.saved += 1; },
    ...overrides
});

const silentLogger = { log() {}, warn() {}, error() {} };

/**
 * Builds a manager with fake clock, fetch, sleep and RNG.
 */
const harness = ({ creds, responses = [], env = {}, nowMs = 1_700_000_000_000 } = {}) => {
    const clock = { now: nowMs };
    const calls = { fetch: [], sleeps: [] };
    const store = creds || { amazon_products: makeCred() };

    const fetchImpl = async (url, init) => {
        calls.fetch.push({ url, init });
        const next = responses.shift();
        if (typeof next === 'function') return next();
        if (next === undefined) throw new Error('no queued response');
        return next;
    };

    const CredsModel = {
        findOneCalls: 0,
        async findOne(query) {
            CredsModel.findOneCalls += 1;
            const source = String(query.api_name.$regex.source).replace(/^\^|\$$/g, '');
            return store[source.toLowerCase()] || null;
        }
    };

    const manager = createTokenManager({
        CredsModel,
        signAssertion: () => 'fake.assertion.jwt',
        authServerUrl: 'http://auth.internal:10000',
        fetchImpl,
        logger: silentLogger,
        env,
        now: () => clock.now,
        sleep: async (ms) => { calls.sleeps.push(ms); },
        random: () => 0
    });

    return { manager, calls, clock, CredsModel, store };
};

const settle = async (times = 6) => {
    for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r));
};

// ─── Pure helpers ──────────────────────────────────────────────────────────

test('shouldRefreshToken: valid token far from expiry is left alone', () => {
    const now = Date.now();
    const verdict = shouldRefreshToken(tokenExpiringIn(3600, now), { now, refreshAheadSeconds: 300 });
    assert.equal(verdict.refresh, false);
    assert.equal(verdict.reason, 'valid');
});

test('shouldRefreshToken: flags near-expiry, expired, malformed and missing', () => {
    const now = Date.now();
    assert.equal(shouldRefreshToken(tokenExpiringIn(120, now), { now }).reason, 'near-expiry');
    assert.equal(shouldRefreshToken(tokenExpiringIn(-10, now), { now }).reason, 'expired');
    assert.equal(shouldRefreshToken('not-a-jwt', { now }).reason, 'undecodable');
    assert.equal(shouldRefreshToken('', { now }).reason, 'missing');
    assert.equal(shouldRefreshToken(null, { now }).reason, 'missing');
    // A JWT with no exp claim must not be treated as immortal.
    assert.equal(shouldRefreshToken(jwt.sign({ a: 1 }, SECRET), { now }).reason, 'undecodable');
});

test('shouldRefreshToken: near-expiry is not marked expired', () => {
    const now = Date.now();
    const verdict = shouldRefreshToken(tokenExpiringIn(60, now), { now, refreshAheadSeconds: 300 });
    assert.equal(verdict.refresh, true);
    assert.equal(verdict.expired, false);
});

test('parseRetryAfter: delta-seconds and HTTP-date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(parseRetryAfter('5', now), 5000);
    assert.equal(parseRetryAfter('  12 ', now), 12000);
    assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now), 30000);
    // A date in the past clamps to zero rather than going negative.
    assert.equal(parseRetryAfter('Thu, 01 Jan 2020 00:00:00 GMT', now), 0);
    assert.equal(parseRetryAfter(null, now), null);
    assert.equal(parseRetryAfter('garbage', now), null);
});

test('joinUrl: no double or missing slashes for internal and public hosts', () => {
    assert.equal(joinUrl('http://auth:10000', '/auth/token/refresh'), 'http://auth:10000/auth/token/refresh');
    assert.equal(joinUrl('http://auth:10000/', '/auth/token/refresh'), 'http://auth:10000/auth/token/refresh');
    assert.equal(joinUrl('https://a.onrender.com//', 'auth/token/refresh'), 'https://a.onrender.com/auth/token/refresh');
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────

test('1. valid token far from expiry → no refresh', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(86400, now) }) },
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(calls.fetch.length, 0);
});

test('2. token inside refresh-ahead window → proactive refresh, request served immediately', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const near = tokenExpiringIn(200, now);
    const { manager, calls, store } = harness({
        creds: { amazon_products: makeCred({ access_token: near }) },
        responses: [jsonResponse(200, { success: true, accessToken: fresh })],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    // Served without waiting on the auth server — the token is still valid.
    assert.equal(result.status, 'ok');
    assert.equal(result.token, near);
    assert.equal(result.refreshing, true);

    await settle();
    assert.equal(calls.fetch.length, 1, 'refresh should have run in the background');
    assert.equal(store.amazon_products.access_token, fresh);
});

test('3. expired token → refresh happens before the provider call', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(200, { success: true, accessToken: fresh })],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(result.token, fresh, 'must return the new token, never the expired one');
    assert.equal(calls.fetch.length, 1);
});

test('4. malformed token → refresh attempted safely (no throw)', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager } = harness({
        creds: { amazon_products: makeCred({ access_token: '!!! not a jwt !!!' }) },
        responses: [jsonResponse(200, { success: true, accessToken: fresh })],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(result.token, fresh);
});

test('5. 20 concurrent requests → exactly one refresh', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const gate = deferred();
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [async () => { await gate.promise; return jsonResponse(200, { success: true, accessToken: fresh }); }],
        nowMs: now
    });

    const inFlight = Array.from({ length: 20 }, (_, i) => manager.getAccessToken('Amazon_Products', `r${i}`));
    await settle();
    gate.resolve();
    const results = await Promise.all(inFlight);

    assert.equal(calls.fetch.length, 1, 'single-flight must collapse 20 requests into 1 refresh');
    assert.ok(results.every((r) => r.status === 'ok' && r.token === fresh));
});

test('6. refresh returns 429 then succeeds → retries and recovers', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [
            jsonResponse(429, { message: 'slow down' }),
            jsonResponse(200, { success: true, accessToken: fresh })
        ],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(calls.fetch.length, 2);
    assert.equal(calls.sleeps.length, 1);
    assert.equal(calls.sleeps[0], 1000, 'first backoff ~1s (jitter stubbed to 0)');
});

test('7. refresh returns 503 then succeeds → retries and recovers', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [
            jsonResponse(503, { message: 'waking up' }),
            jsonResponse(200, { success: true, accessToken: fresh })
        ],
        nowMs: now
    });

    assert.equal((await manager.getAccessToken('Amazon_Products', 'r1')).status, 'ok');
    assert.equal(calls.fetch.length, 2);
});

test('8. refresh returns 401 → permanent, no retry loop', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(401, { message: 'Assertion invalid' })],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'unavailable');
    assert.equal(calls.fetch.length, 1, '401 must not be retried');
    assert.equal(calls.sleeps.length, 0);
});

test('9. Retry-After is honoured and capped', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [
            jsonResponse(429, { message: 'slow down' }, { 'retry-after': '7' }),
            jsonResponse(200, { success: true, accessToken: fresh })
        ],
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(calls.sleeps[0], 7000, 'Retry-After should win over exponential backoff');
});

test('9b. an absurd Retry-After is clamped to REFRESH_MAX_RETRY_DELAY_MS', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [
            jsonResponse(429, {}, { 'retry-after': '86400' }),
            jsonResponse(429, {}, { 'retry-after': '86400' }),
            jsonResponse(429, {}, { 'retry-after': '86400' })
        ],
        env: { REFRESH_MAX_RETRY_DELAY_MS: '5000' },
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    assert.ok(calls.sleeps.every((ms) => ms <= 5000), `expected all delays <= 5000, got ${calls.sleeps}`);
});

test('10. refresh timeout is treated as transient and retried', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [
            () => { throw abortError; },
            jsonResponse(200, { success: true, accessToken: fresh })
        ],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(calls.fetch.length, 2);
});

test('11. retries exhausted + expired token → controlled unavailable', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(429, {}), jsonResponse(429, {}), jsonResponse(429, {})],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'unavailable');
    assert.equal(calls.fetch.length, 3, 'REFRESH_MAX_ATTEMPTS defaults to 3');
});

test('11b. after exhaustion the cooldown suppresses further refresh attempts', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(429, {}), jsonResponse(429, {}), jsonResponse(429, {})],
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(calls.fetch.length, 3);

    const second = await manager.getAccessToken('Amazon_Products', 'r2');
    assert.equal(second.status, 'unavailable');
    assert.equal(calls.fetch.length, 3, 'cooldown must prevent an immediate retry storm');
});

test('12. refreshed token is persisted with expiry metadata', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, store } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(200, { success: true, accessToken: fresh })],
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    const cred = store.amazon_products;
    assert.equal(cred.access_token, fresh);
    assert.equal(cred.saved, 1);
    assert.ok(cred.token_expires_at instanceof Date);
    assert.ok(cred.refreshed_at instanceof Date);
    assert.equal(Math.round(cred.token_expires_at.getTime() / 1000), Math.floor(now / 1000) + 86400);
});

test('13. cache is updated after refresh (no second DB read, no re-refresh)', async () => {
    const now = 1_700_000_000_000;
    const fresh = tokenExpiringIn(86400, now);
    const { manager, calls, CredsModel } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(200, { success: true, accessToken: fresh })],
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    const dbReads = CredsModel.findOneCalls;

    const again = await manager.getAccessToken('Amazon_Products', 'r2');
    assert.equal(again.token, fresh);
    assert.equal(calls.fetch.length, 1, 'no second refresh');
    assert.equal(CredsModel.findOneCalls, dbReads, 'served from cache');
});

test('14. reactive path: refreshAfterRejection drops the cached token and renews', async () => {
    const now = 1_700_000_000_000;
    const good = tokenExpiringIn(86400, now);
    const newer = tokenExpiringIn(90000, now);
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: good }) },
        responses: [jsonResponse(200, { success: true, accessToken: newer })],
        nowMs: now
    });

    // Token looks perfectly valid, so nothing proactive fires...
    const first = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(first.token, good);
    assert.equal(calls.fetch.length, 0);

    // ...but the provider rejects it as superseded. Reactive refresh runs.
    const replaced = await manager.refreshAfterRejection('Amazon_Products', 'r1');
    assert.equal(replaced, newer);
    assert.equal(calls.fetch.length, 1);

    const after = await manager.getAccessToken('Amazon_Products', 'r2');
    assert.equal(after.token, newer, 'cache must hold the replacement');
});

test('15. no credential document → not_provisioned, no auth-server traffic', async () => {
    const { manager, calls } = harness({ creds: {} });
    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'not_provisioned');
    assert.equal(calls.fetch.length, 0);
});

test('16. Amazon and Walmart refresh independently', async () => {
    const now = 1_700_000_000_000;
    const amazonFresh = tokenExpiringIn(86400, now, 'amazon');
    const walmartFresh = tokenExpiringIn(86400, now, 'walmart');
    const { manager, calls } = harness({
        creds: {
            amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }),
            walmart: makeCred({ client_id: 'c2', api_name: 'Walmart', access_token: tokenExpiringIn(-60, now) })
        },
        responses: [
            jsonResponse(200, { success: true, accessToken: amazonFresh }),
            jsonResponse(200, { success: true, accessToken: walmartFresh })
        ],
        nowMs: now
    });

    const [a, w] = await Promise.all([
        manager.getAccessToken('Amazon_Products', 'r1'),
        manager.getAccessToken('Walmart', 'r2')
    ]);

    assert.equal(a.status, 'ok');
    assert.equal(w.status, 'ok');
    assert.notEqual(a.token, w.token);
    assert.equal(calls.fetch.length, 2, 'one refresh each — providers must not share a key');
});

test('17. refresh POSTs to a correctly joined URL and sends a bearer assertion', async () => {
    const now = 1_700_000_000_000;
    const { manager, calls } = harness({
        creds: { amazon_products: makeCred({ access_token: tokenExpiringIn(-60, now) }) },
        responses: [jsonResponse(200, { success: true, accessToken: tokenExpiringIn(86400, now) })],
        nowMs: now
    });

    await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(calls.fetch[0].url, 'http://auth.internal:10000/auth/token/refresh');
    assert.equal(calls.fetch[0].init.method, 'POST');
    assert.match(calls.fetch[0].init.headers.Authorization, /^Bearer /);
    assert.ok(calls.fetch[0].init.signal, 'must pass an AbortSignal for the timeout');
});

test('18. a still-valid token is served when a background refresh fails', async () => {
    const now = 1_700_000_000_000;
    const near = tokenExpiringIn(200, now);
    const { manager } = harness({
        creds: { amazon_products: makeCred({ access_token: near }) },
        responses: [jsonResponse(500, { message: 'boom' })],
        nowMs: now
    });

    const result = await manager.getAccessToken('Amazon_Products', 'r1');
    assert.equal(result.status, 'ok');
    assert.equal(result.token, near, 'fall back to the valid token rather than failing the shopper');
    await settle();

    const second = await manager.getAccessToken('Amazon_Products', 'r2');
    assert.equal(second.status, 'ok', 'still served while the token has life left');
});
