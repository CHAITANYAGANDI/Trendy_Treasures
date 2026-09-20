'use strict';

// Guards the http-proxy-middleware option shape used in app.js.
//
// v3 reads event handlers from `options.on` only. The v2-style top-level
// `onProxyReq` / `onProxyRes` keys are accepted without complaint and then
// ignored — they are translated solely by legacyCreateProxyMiddleware, which
// we don't use. app.js relied on the v2 shape, so its forwardHeaders hook
// never ran in production: the Users service received no x-real-client-ip
// (and therefore rate-limited every shopper under the gateway's single
// egress IP) and no x-request-id (so its logs couldn't be correlated with
// the gateway's).
//
// Nothing about that failure was visible — no warning, no error, just
// missing headers. This test fails loudly if the shape regresses, or if a
// library upgrade changes which shape is honoured.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Upstream that simply reports the headers it was given.
const startUpstream = async () => {
    const app = express();
    app.all('*', (req, res) =>
        res.json({
            requestId: req.headers['x-request-id'] || null,
            realClientIp: req.headers['x-real-client-ip'] || null,
            internalAuth: req.headers['x-internal-auth'] ? 'present' : null
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return { server, port: server.address().port };
};

const setHeaders = (proxyReq) => {
    proxyReq.setHeader('x-request-id', 'rid-test');
    proxyReq.setHeader('x-real-client-ip', '203.0.113.77');
    proxyReq.setHeader('x-internal-auth', 'test-secret');
};

// Mirrors app.js's mount for /api/v1/user.
const startGateway = async (upstreamPort, proxyOptions) => {
    const app = express();
    app.use(
        '/api/v1/user',
        createProxyMiddleware({
            target: `http://127.0.0.1:${upstreamPort}`,
            changeOrigin: true,
            pathRewrite: { '^/api/v1/user': '/' },
            ...proxyOptions
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return { server, port: server.address().port };
};

const proxied = async (proxyOptions) => {
    const up = await startUpstream();
    const gw = await startGateway(up.port, proxyOptions);
    try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/api/v1/user/csrf-token`);
        return await res.json();
    } finally {
        await new Promise((r) => gw.server.close(r));
        await new Promise((r) => up.server.close(r));
    }
};


test('on.proxyReq forwards the correlation and client-IP headers', async () => {
    const seen = await proxied({ on: { proxyReq: setHeaders } });
    assert.equal(seen.requestId, 'rid-test');
    assert.equal(seen.realClientIp, '203.0.113.77');
    assert.equal(seen.internalAuth, 'present');
});

test('the v2-style onProxyReq key is silently ignored — do not use it', async () => {
    const seen = await proxied({ onProxyReq: setHeaders });
    assert.equal(seen.requestId, null, 'v2 shape must not be assumed to work');
    assert.equal(seen.realClientIp, null);
    assert.equal(
        seen.internalAuth,
        null,
        'if this starts passing, the library changed and app.js can be simplified'
    );
});

test('on.proxyRes can observe and annotate the upstream response', async () => {
    const up = await startUpstream();
    const gw = await startGateway(up.port, {
        on: {
            proxyRes: (proxyRes) => {
                proxyRes.headers['x-ratelimit-source'] = 'upstream-app';
            }
        }
    });
    try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/api/v1/user/csrf-token`);
        assert.equal(res.headers.get('x-ratelimit-source'), 'upstream-app');
    } finally {
        await new Promise((r) => gw.server.close(r));
        await new Promise((r) => up.server.close(r));
    }
});
