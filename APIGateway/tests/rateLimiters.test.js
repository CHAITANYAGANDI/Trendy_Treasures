'use strict';

// Exercises the real limiter stack over real HTTP: a throwaway express app
// mounts installRateLimiters() exactly as app.js does, listens on an
// ephemeral port, and we drive it with global fetch. No supertest, no new
// dependencies.
//
// Each test uses a unique CF-Connecting-IP so buckets can't bleed between
// tests — clientIp() prefers that header, which is also what production does.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { installRateLimiters } = require('../middleware/rateLimiters');

const GENERAL_MAX = 3;
const AUTH_MAX = 2;
const CSRF_MAX = 2;

const TEST_ENV = {
    RATE_LIMIT_PER_MIN: String(GENERAL_MAX),
    AUTH_RATE_LIMIT_PER_15M: String(AUTH_MAX),
    CSRF_RATE_LIMIT_PER_MIN: String(CSRF_MAX)
};

// Spin up an isolated app per test so limiter state never carries over.
const startServer = async ({ storefrontUrl = '' } = {}) => {
    const warnings = [];
    const app = express();

    // Stand-in for the correlation-ID middleware in app.js, so the rejection
    // log has a request id to include.
    let n = 0;
    app.use((req, res, next) => {
        req.requestId = `req-${(n += 1)}`;
        next();
    });

    installRateLimiters(app, {
        env: TEST_ENV,
        storefrontUrl,
        logger: { warn: (m) => warnings.push(m), log() {}, error() {} }
    });

    // Express 4 wildcard syntax (the repo pins ^4.21).
    app.all('*', (req, res) => res.json({ ok: true, path: req.path }));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();

    const call = (path, { method = 'GET', ip = '203.0.113.1', headers = {} } = {}) =>
        fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            redirect: 'manual',
            headers: { 'cf-connecting-ip': ip, ...headers }
        });

    // `fetch` (undici) treats Sec-Fetch-* as forbidden headers and forces
    // `Sec-Fetch-Mode: cors`, so a navigation cannot be simulated with it.
    // Raw http.request sends exactly what we ask for.
    const rawCall = (path, { method = 'GET', ip = '203.0.113.1', headers = {} } = {}) =>
        new Promise((resolve, reject) => {
            const req = http.request(
                { host: '127.0.0.1', port, path, method, headers: { 'cf-connecting-ip': ip, ...headers } },
                (res) => {
                    let body = '';
                    res.on('data', (c) => { body += c; });
                    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
                }
            );
            req.on('error', reject);
            req.end();
        });

    return {
        call,
        rawCall,
        warnings,
        close: () => new Promise((resolve) => server.close(resolve))
    };
};

// Spend the whole general budget for one IP. Uses a path with no dedicated
// limiter of its own.
const drainGeneral = async (call, ip) => {
    for (let i = 0; i < GENERAL_MAX; i += 1) {
        const res = await call('/api/v1/amazon/products/get', { ip });
        assert.equal(res.status, 200, `general request ${i + 1} should pass`);
    }
    const blocked = await call('/api/v1/amazon/products/get', { ip });
    assert.equal(blocked.status, 429, 'general budget should now be exhausted');
};


test('OPTIONS preflights do not consume the general budget', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.10';

        // Far more preflights than the budget allows.
        for (let i = 0; i < GENERAL_MAX + 5; i += 1) {
            const res = await s.call('/api/v1/amazon/products/get', { method: 'OPTIONS', ip });
            assert.notEqual(res.status, 429, `preflight ${i + 1} must never be throttled`);
        }

        // The real budget is untouched.
        for (let i = 0; i < GENERAL_MAX; i += 1) {
            const res = await s.call('/api/v1/amazon/products/get', { ip });
            assert.equal(res.status, 200, `GET ${i + 1} should still pass`);
        }
        const blocked = await s.call('/api/v1/amazon/products/get', { ip });
        assert.equal(blocked.status, 429);
    } finally {
        await s.close();
    }
});

test('/health is never throttled', async () => {
    const s = await startServer();
    try {
        for (let i = 0; i < GENERAL_MAX + 5; i += 1) {
            const res = await s.call('/health', { ip: '203.0.113.11' });
            assert.notEqual(res.status, 429, `health check ${i + 1} must not be throttled`);
        }
    } finally {
        await s.close();
    }
});

test('admin login is NOT blocked by an exhausted general bucket', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.12';
        await drainGeneral(s.call, ip);

        // This is the regression: signing in was billed to the general bucket
        // too, so ordinary browsing locked the user out of recovering.
        const login = await s.call('/api/v1/user/admin/login', { method: 'POST', ip });
        assert.equal(login.status, 200, 'admin login must survive an exhausted general bucket');
    } finally {
        await s.close();
    }
});

test('every auth route is exempt from the general bucket', async () => {
    const s = await startServer();
    try {
        const paths = [
            '/api/v1/user/auth/login',
            '/api/v1/user/auth/signup',
            '/api/v1/user/auth/verifyotp',
            '/api/v1/user/admin/login',
            '/api/v1/user/recovery'
        ];
        for (const path of paths) {
            const ip = `203.0.113.${20 + paths.indexOf(path)}`;
            await drainGeneral(s.call, ip);
            const res = await s.call(path, { method: 'POST', ip });
            assert.equal(res.status, 200, `${path} should not be blocked by the general bucket`);
        }
    } finally {
        await s.close();
    }
});

test('authLimiter still protects admin login from brute force', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.13';
        for (let i = 0; i < AUTH_MAX; i += 1) {
            const res = await s.call('/api/v1/user/admin/login', { method: 'POST', ip });
            assert.equal(res.status, 200, `attempt ${i + 1} should pass`);
        }
        const blocked = await s.call('/api/v1/user/admin/login', { method: 'POST', ip });
        assert.equal(blocked.status, 429, 'auth budget must still close');
        const body = await blocked.json();
        assert.match(body.error, /too many auth attempts/i);
    } finally {
        await s.close();
    }
});

test('csrf-token has its own bucket, separate from the general one', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.14';
        await drainGeneral(s.call, ip);

        // The bootstrap must still work — it is what unblocks the SPA's first
        // state-changing request.
        const res = await s.call('/api/v1/user/csrf-token', { ip });
        assert.equal(res.status, 200, 'csrf bootstrap must not share the general bucket');
    } finally {
        await s.close();
    }
});

test('csrf-token is bounded, not unlimited', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.15';
        for (let i = 0; i < CSRF_MAX; i += 1) {
            const res = await s.call('/api/v1/user/csrf-token', { ip });
            assert.equal(res.status, 200, `bootstrap ${i + 1} should pass`);
        }
        const blocked = await s.call('/api/v1/user/csrf-token', { ip });
        assert.equal(blocked.status, 429, 'csrf endpoint must not be an unmetered proxy');
    } finally {
        await s.close();
    }
});

test('auth and general buckets are independent in both directions', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.16';

        // Exhaust the auth budget...
        for (let i = 0; i < AUTH_MAX; i += 1) {
            await s.call('/api/v1/user/auth/login', { method: 'POST', ip });
        }
        const authBlocked = await s.call('/api/v1/user/auth/login', { method: 'POST', ip });
        assert.equal(authBlocked.status, 429);

        // ...browsing still works.
        const browse = await s.call('/api/v1/amazon/products/get', { ip });
        assert.equal(browse.status, 200, 'a spent auth budget must not block browsing');
    } finally {
        await s.close();
    }
});

test('rejection is logged with limiter name, method, path, ip and request id', async () => {
    const s = await startServer();
    try {
        const ip = '203.0.113.17';
        await drainGeneral(s.call, ip);

        const line = s.warnings.find((m) => m.includes('generalLimiter'));
        assert.ok(line, `expected a generalLimiter warning, got: ${JSON.stringify(s.warnings)}`);
        assert.match(line, /generalLimiter rejected/);
        assert.match(line, /GET \/api\/v1\/amazon\/products\/get/);
        assert.match(line, new RegExp(`ip=${ip.replace(/\./g, '\\.')}`));
        assert.match(line, /\[req-\d+\]/);

        // Nothing secret leaks into the log line.
        assert.doesNotMatch(line, /cf-connecting-ip|authorization|secret|cookie/i);
    } finally {
        await s.close();
    }
});

test('a throttled browser navigation redirects to the login page', async () => {
    const s = await startServer({ storefrontUrl: 'https://store.example' });
    try {
        const ip = '203.0.113.18';
        await drainGeneral(s.call, ip);

        // What Chrome actually sends when submitting the "Continue with
        // Google" GET form.
        const nav = await s.rawCall('/api/v1/user/auth/google', {
            ip,
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-dest': 'document'
            }
        });
        assert.equal(nav.status, 302);
        assert.equal(nav.headers.location, 'https://store.example/login?error=rate_limited');
    } finally {
        await s.close();
    }
});

test('a throttled XHR still receives JSON, not a redirect', async () => {
    const s = await startServer({ storefrontUrl: 'https://store.example' });
    try {
        const ip = '203.0.113.19';
        await drainGeneral(s.call, ip);

        const xhr = await s.call('/api/v1/user/cart/get', {
            ip,
            headers: { accept: 'application/json', 'sec-fetch-mode': 'cors' }
        });
        assert.equal(xhr.status, 429);
        const body = await xhr.json();
        assert.match(body.error, /too many requests/i);
    } finally {
        await s.close();
    }
});

test('a same-origin fetch asking for HTML is not treated as a navigation', async () => {
    const s = await startServer({ storefrontUrl: 'https://store.example' });
    try {
        const ip = '203.0.113.21';
        await drainGeneral(s.call, ip);

        // Sec-Fetch-Mode: same-origin is a fetch, not a navigation. Sending
        // it a redirect would break a caller that is waiting to read JSON.
        const res = await s.rawCall('/api/v1/user/auth/me', {
            ip,
            headers: { accept: 'text/html', 'sec-fetch-mode': 'same-origin' }
        });
        assert.equal(res.status, 429);
        assert.equal(res.headers.location, undefined);
    } finally {
        await s.close();
    }
});

test('buckets are per-IP, so one shopper cannot throttle another', async () => {
    const s = await startServer();
    try {
        await drainGeneral(s.call, '203.0.113.30');
        const other = await s.call('/api/v1/amazon/products/get', { ip: '203.0.113.31' });
        assert.equal(other.status, 200);
    } finally {
        await s.close();
    }
});
