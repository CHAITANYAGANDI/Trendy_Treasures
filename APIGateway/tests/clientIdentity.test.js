'use strict';

// Portable client-identity resolution.
//
// Covers the security property that matters most: a caller-supplied header
// is only ever believed when it is authenticated by our own gateway secret,
// or when the deployment explicitly declares a platform edge known to
// overwrite it. Getting that wrong in either direction is a real bug —
// one merges every shopper into one rate-limit bucket, the other hands out
// a fresh bucket per request to anyone who sets a header.
//
// Deliberately no assertions about Google's or Cloudflare's IP ranges:
// those change, and the logic must not depend on them.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
    resolvePlatform,
    trustProxySetting,
    hasInternalAuth,
    normalizeIp,
    resolveClientIp,
    clientIdentityKey,
    describePlatform,
    PLATFORM_PRESETS
} = require('../middleware/clientIdentity');

const SECRET = 'test-internal-secret-value';

const fakeReq = (headers = {}, ip = '10.0.0.1') => ({ headers, ip });

const CLOUD_RUN = { DEPLOYMENT_PLATFORM: 'cloud-run', INTERNAL_AUTH_SECRET: SECRET };
const RENDER = { DEPLOYMENT_PLATFORM: 'render', INTERNAL_AUTH_SECRET: SECRET };
const LOCAL = { DEPLOYMENT_PLATFORM: 'local', INTERNAL_AUTH_SECRET: SECRET };


// ─── Platform resolution ───────────────────────────────────────────────────

test('platform names and aliases resolve; unknown values fail safe', () => {
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: 'cloud-run' }), 'cloud-run');
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: 'CloudRun' }), 'cloud-run');
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: ' GCP ' }), 'cloud-run');
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: 'render' }), 'render');
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: 'local' }), 'local');

    // Nonsense must not silently become a permissive preset.
    assert.equal(resolvePlatform({ DEPLOYMENT_PLATFORM: 'heroku-ish' }), 'local');
    assert.equal(
        resolvePlatform({ DEPLOYMENT_PLATFORM: 'heroku-ish', NODE_ENV: 'production' }),
        'cloud-run'
    );
});

test('the production default is the conservative preset', () => {
    // cloud-run trusts one hop and NO caller header. Defaulting to `render`
    // would trust a forgeable header wherever Cloudflare is absent.
    assert.equal(resolvePlatform({ NODE_ENV: 'production' }), 'cloud-run');
    assert.equal(resolvePlatform({}), 'local');
    assert.equal(PLATFORM_PRESETS['cloud-run'].edgeIpHeader, null);
});

test('trust proxy comes from the preset and refuses `true`', () => {
    assert.equal(trustProxySetting(CLOUD_RUN), 1);
    assert.equal(trustProxySetting(RENDER), 2);
    assert.equal(trustProxySetting(LOCAL), 'loopback');

    // Explicit overrides for topologies without a named preset.
    assert.equal(trustProxySetting({ ...CLOUD_RUN, TRUST_PROXY: '3' }), 3);
    assert.equal(trustProxySetting({ ...CLOUD_RUN, TRUST_PROXY: 'loopback' }), 'loopback');

    // `true` lets any caller spoof X-Forwarded-For — must be ignored.
    assert.equal(trustProxySetting({ ...CLOUD_RUN, TRUST_PROXY: 'true' }), 1);
    assert.equal(trustProxySetting({ ...RENDER, TRUST_PROXY: 'TRUE' }), 2);

    // Blank is treated as unset, not as a value.
    assert.equal(trustProxySetting({ ...CLOUD_RUN, TRUST_PROXY: '   ' }), 1);
});

test('describePlatform reports the effective policy', () => {
    assert.match(describePlatform(CLOUD_RUN), /platform=cloud-run/);
    assert.match(describePlatform(CLOUD_RUN), /trustProxy=1/);
    assert.match(describePlatform(CLOUD_RUN), /edgeHeader=none/);
    assert.match(describePlatform(RENDER), /edgeHeader=cf-connecting-ip/);
});


// ─── Gateway-authenticated forwarding ──────────────────────────────────────

test('1. x-real-client-ip is accepted when the internal secret matches', () => {
    const req = fakeReq({
        'x-internal-auth': SECRET,
        'x-real-client-ip': '198.51.100.7'
    });
    const resolved = resolveClientIp(req, { env: CLOUD_RUN });
    assert.equal(resolved.ip, '198.51.100.7');
    assert.equal(resolved.source, 'gateway');
    assert.equal(clientIdentityKey(req, { env: CLOUD_RUN }), 'gw:198.51.100.7');
});

test('2. a forged x-real-client-ip is ignored without the secret', () => {
    const forged = { 'x-real-client-ip': '198.51.100.7' };

    // No secret header at all.
    assert.equal(resolveClientIp(fakeReq(forged), { env: CLOUD_RUN }).ip, '10.0.0.1');
    // Wrong secret.
    assert.equal(
        resolveClientIp(
            fakeReq({ ...forged, 'x-internal-auth': 'wrong-secret-value' }),
            { env: CLOUD_RUN }
        ).ip,
        '10.0.0.1'
    );
    // Right length, wrong bytes — exercises the timing-safe path rather than
    // a length short-circuit.
    assert.equal(
        resolveClientIp(
            fakeReq({ ...forged, 'x-internal-auth': 'x'.repeat(SECRET.length) }),
            { env: CLOUD_RUN }
        ).ip,
        '10.0.0.1'
    );
    // Service configured without a secret must not accept the header either.
    assert.equal(
        resolveClientIp(
            fakeReq({ ...forged, 'x-internal-auth': SECRET }),
            { env: { DEPLOYMENT_PLATFORM: 'cloud-run' } }
        ).ip,
        '10.0.0.1'
    );
});

test('the gateway itself never trusts a forwarded client IP', () => {
    // The gateway is the public entry point; it has no upstream whose
    // headers it should believe, even one presenting the shared secret.
    const req = fakeReq({ 'x-internal-auth': SECRET, 'x-real-client-ip': '198.51.100.7' });
    const resolved = resolveClientIp(req, { env: CLOUD_RUN, trustGatewayHeader: false });
    assert.equal(resolved.ip, '10.0.0.1');
    assert.equal(resolved.source, 'socket');
});

test('hasInternalAuth is false for missing, empty and mismatched secrets', () => {
    assert.equal(hasInternalAuth(fakeReq({}), CLOUD_RUN), false);
    assert.equal(hasInternalAuth(fakeReq({ 'x-internal-auth': '' }), CLOUD_RUN), false);
    assert.equal(hasInternalAuth(fakeReq({ 'x-internal-auth': 'nope' }), CLOUD_RUN), false);
    assert.equal(hasInternalAuth(fakeReq({ 'x-internal-auth': SECRET }), CLOUD_RUN), true);
});


// ─── Edge header is opt-in per platform ────────────────────────────────────

test('CF-Connecting-IP is honoured on render but NOT on cloud-run', () => {
    const req = fakeReq({ 'cf-connecting-ip': '203.0.113.55' });

    // Render declares a Cloudflare edge that sets and overwrites the header.
    assert.equal(resolveClientIp(req, { env: RENDER }).ip, '203.0.113.55');
    assert.equal(resolveClientIp(req, { env: RENDER }).source, 'edge');

    // Cloud Run has no such edge, so the header is caller-controlled.
    // Trusting it here would be a free rate-limit bypass.
    assert.equal(resolveClientIp(req, { env: CLOUD_RUN }).ip, '10.0.0.1');
    assert.equal(resolveClientIp(req, { env: LOCAL }).ip, '10.0.0.1');
});

test('an authenticated gateway IP outranks the edge header', () => {
    const req = fakeReq({
        'x-internal-auth': SECRET,
        'x-real-client-ip': '198.51.100.7',
        'cf-connecting-ip': '203.0.113.55'
    });
    assert.equal(resolveClientIp(req, { env: RENDER }).ip, '198.51.100.7');
});


// ─── Identity distinctness and IPv6 ────────────────────────────────────────

test('3. distinct IPv4 callers get distinct identities', () => {
    const a = clientIdentityKey(fakeReq({}, '198.51.100.1'), { env: CLOUD_RUN });
    const b = clientIdentityKey(fakeReq({}, '198.51.100.2'), { env: CLOUD_RUN });
    assert.notEqual(a, b);
    assert.equal(a, '198.51.100.1');
});

test('4. IPv6 is normalised to a /64 prefix', () => {
    // Same /64, different low bits — must collapse to one identity.
    assert.equal(normalizeIp('2001:db8:1234:5678:1:2:3:4'), '2001:db8:1234:5678::/64');
    assert.equal(
        normalizeIp('2001:db8:1234:5678:1:2:3:4'),
        normalizeIp('2001:db8:1234:5678:9:9:9:9')
    );
    // A different /64 stays distinct.
    assert.notEqual(
        normalizeIp('2001:db8:1234:5678::1'),
        normalizeIp('2001:db8:1234:9999::1')
    );
    // IPv4 passes through untouched.
    assert.equal(normalizeIp('198.51.100.1'), '198.51.100.1');
    assert.equal(normalizeIp(undefined), 'unknown');
});

test('IPv6 normalisation also applies to a gateway-forwarded address', () => {
    const req = fakeReq({
        'x-internal-auth': SECRET,
        'x-real-client-ip': '2001:db8:1234:5678:1:2:3:4'
    });
    assert.equal(clientIdentityKey(req, { env: CLOUD_RUN }), 'gw:2001:db8:1234:5678::/64');
});

test('gateway-forwarded identities are namespaced away from direct callers', () => {
    // A direct caller must never land in a proxied shopper's bucket, even
    // presenting the same address.
    const viaGateway = clientIdentityKey(
        fakeReq({ 'x-internal-auth': SECRET, 'x-real-client-ip': '198.51.100.9' }),
        { env: CLOUD_RUN }
    );
    const direct = clientIdentityKey(fakeReq({}, '198.51.100.9'), { env: CLOUD_RUN });
    assert.equal(viaGateway, 'gw:198.51.100.9');
    assert.equal(direct, '198.51.100.9');
    assert.notEqual(viaGateway, direct);
});

test('a custom normalizer is honoured (services keep their own subnet rules)', () => {
    const key = clientIdentityKey(fakeReq({}, '198.51.100.1'), {
        env: CLOUD_RUN,
        normalize: (ip) => `norm(${ip})`
    });
    assert.equal(key, 'norm(198.51.100.1)');
});


// ─── End-to-end through Express, with real trust-proxy behaviour ───────────

const startApp = async (env) => {
    const app = express();
    app.set('trust proxy', trustProxySetting(env));
    app.get('/whoami', (req, res) =>
        res.json({
            key: clientIdentityKey(req, { env }),
            resolved: resolveClientIp(req, { env })
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    // Raw http so no header is rewritten by undici.
    const get = (headers = {}) =>
        new Promise((resolve, reject) => {
            const req = http.request(
                { host: '127.0.0.1', port, path: '/whoami', method: 'GET', headers },
                (res) => {
                    let body = '';
                    res.on('data', (c) => { body += c; });
                    res.on('end', () => resolve(JSON.parse(body)));
                }
            );
            req.on('error', reject);
            req.end();
        });
    return { get, close: () => new Promise((r) => server.close(r)) };
};

test('5. a Cloud-Run-style forwarded request resolves to a stable identity', async () => {
    const app = await startApp(CLOUD_RUN);
    try {
        // Cloud Run's front end is the one trusted hop, and the caller's
        // address is the final X-Forwarded-For entry.
        const a = await app.get({ 'x-forwarded-for': '198.51.100.23' });
        assert.equal(a.key, '198.51.100.23');

        // Stable across repeats — the identity must not drift per request.
        const b = await app.get({ 'x-forwarded-for': '198.51.100.23' });
        assert.equal(b.key, a.key);

        // A caller prepending forged hops cannot displace the trusted last
        // entry, so they cannot mint a new bucket this way.
        const forged = await app.get({
            'x-forwarded-for': '1.1.1.1, 2.2.2.2, 198.51.100.23'
        });
        assert.equal(forged.key, '198.51.100.23');
    } finally {
        await app.close();
    }
});

test('6. a local direct request resolves to the socket identity', async () => {
    const app = await startApp(LOCAL);
    try {
        // No forwarded header at all — the genuine "direct request" case.
        const res = await app.get({});
        // Loopback over IPv4-mapped IPv6 or plain IPv4, depending on the host.
        assert.ok(
            res.resolved.ip.includes('127.0.0.1') || res.resolved.ip.includes('::1'),
            `expected a loopback address, got ${res.resolved.ip}`
        );
        assert.equal(res.resolved.source, 'socket');
        // And it is a usable, non-empty key.
        assert.ok(res.key && res.key !== 'unknown');
    } finally {
        await app.close();
    }
});

test('6b. locally, X-Forwarded-For IS honoured from a loopback peer (by design)', async () => {
    const app = await startApp(LOCAL);
    try {
        // `trust proxy = 'loopback'` means exactly this: believe
        // X-Forwarded-For when the immediate peer is a loopback address.
        // Here the test client connects from 127.0.0.1, so Express honours
        // the header — that is correct behaviour, not a bypass.
        //
        // It is safe because only a process on this same machine can reach a
        // loopback listener, and it is what makes a local reverse proxy
        // (nginx, a dev gateway) able to report the real caller. Nothing
        // reachable from another host is trusted.
        //
        // This preset is never used in production: `cloud-run` trusts exactly
        // one hop regardless of peer address, and `render` trusts two — see
        // test 5 for the Cloud Run case, where a caller prepending forged
        // entries cannot displace the trusted one.
        const forwarded = await app.get({ 'x-forwarded-for': '198.51.100.99' });
        assert.equal(forwarded.key, '198.51.100.99');
        assert.equal(forwarded.resolved.source, 'socket');
    } finally {
        await app.close();
    }
});

test('6c. a non-loopback peer is required for the local preset to be bypassable', () => {
    // Guards the reasoning above: `local` resolves to 'loopback', which is a
    // peer-address rule, not a hop count. If someone changed it to a number
    // or to `true`, a forwarded header would be believed from ANY peer.
    assert.equal(trustProxySetting(LOCAL), 'loopback');
    assert.notEqual(trustProxySetting(LOCAL), true);
});

test('a gateway-forwarded request is honoured end-to-end through Express', async () => {
    const app = await startApp(CLOUD_RUN);
    try {
        const res = await app.get({
            'x-forwarded-for': '10.20.30.40',
            'x-internal-auth': SECRET,
            'x-real-client-ip': '198.51.100.77'
        });
        assert.equal(res.key, 'gw:198.51.100.77');
        assert.equal(res.resolved.source, 'gateway');
    } finally {
        await app.close();
    }
});
