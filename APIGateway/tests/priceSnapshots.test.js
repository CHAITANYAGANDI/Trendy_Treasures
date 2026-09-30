'use strict';

// Run with:  npm test          (from APIGateway/)
//            node --test tests/
//
// The snapshot policy behind the Price History chart and price-drop alerts:
// snapshot when the price changed OR the latest snapshot is stale; skip an
// unchanged price inside the stale window. Models, fetch and the clock are
// in-memory fakes, so no Mongo or network is involved.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPriceRecorder, snapshotDecision } = require('../services/priceSnapshots');

const HOUR = 60 * 60 * 1000;
const STALE_MS = 6 * HOUR;
const START = Date.UTC(2026, 8, 30, 12, 0, 0);
const MACBOOK = '6a0863345386990a87ed531e';

const quietLogger = { log() {}, warn() {}, error() {} };

// An in-memory price_snapshots + price_alerts, shaped like the Mongoose
// calls the recorder makes, plus a controllable clock and a fetch spy.
const harness = ({ snapshots = [], alerts = [], env = { INTERNAL_AUTH_SECRET: 'test-internal' } } = {}) => {
    const clock = { now: START };
    const rows = snapshots.map((r) => ({ ...r, snapshotted_at: new Date(r.snapshotted_at) }));
    const calls = [];
    let createGate = null; // when set, create() waits on it — for the concurrency test

    const latest = ({ provider, product_id }) =>
        rows
            .filter((r) => r.provider === provider && r.product_id === product_id)
            .sort((a, b) => b.snapshotted_at - a.snapshotted_at)[0] || null;

    const PriceSnapshot = {
        findOne(filter) {
            const query = {
                sort: () => query,
                select: async () => latest(filter)
            };
            return query;
        },
        async create(doc) {
            if (createGate) await createGate;
            const row = { ...doc, snapshotted_at: new Date(clock.now) };
            rows.push(row);
            return row;
        }
    };

    const PriceAlert = {
        async find(q) {
            const cutoff = q.$or[1].last_notified_at.$lt;
            return alerts.filter((a) =>
                a.provider === q.provider &&
                a.product_id === q.product_id &&
                a.threshold_price >= q.threshold_price.$gte &&
                (a.last_notified_at == null || a.last_notified_at < cutoff));
        }
    };

    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return { ok: true, text: async () => '' };
    };

    const { recordPriceAndEvaluateAlerts } = createPriceRecorder({
        PriceSnapshot,
        PriceAlert,
        usersTarget: 'http://users.test',
        staleMs: STALE_MS,
        fetchImpl,
        logger: quietLogger,
        env,
        now: () => clock.now
    });

    const view = (provider, price, product_id = MACBOOK) =>
        recordPriceAndEvaluateAlerts(
            provider,
            { product_id, product_name: 'Apple MacBook Pro 14 Inch Space Grey', price },
            `https://gateway.test/api/v1/${provider}/products/${product_id}`,
            'req-test'
        );

    const history = (provider, product_id = MACBOOK) =>
        rows
            .filter((r) => r.provider === provider && r.product_id === product_id)
            .sort((a, b) => a.snapshotted_at - b.snapshotted_at)
            .map((r) => r.price);

    return {
        clock,
        rows,
        calls,
        view,
        history,
        holdCreates: () => {
            let release;
            createGate = new Promise((r) => { release = r; });
            return () => { createGate = null; release(); };
        }
    };
};

const snap = (provider, price, agoMs) => ({
    provider,
    product_id: MACBOOK,
    product_name: 'Apple MacBook Pro 14 Inch Space Grey',
    price,
    snapshotted_at: START - agoMs
});

for (const provider of ['walmart', 'amazon']) {
    test(`[${provider}] 1. no previous snapshot → records one`, async () => {
        const h = harness();
        const result = await h.view(provider, 1999.99);
        assert.deepEqual(result, { recorded: true, reason: 'first', alerts: 0 });
        assert.deepEqual(h.history(provider), [1999.99]);
    });

    test(`[${provider}] 2. recent snapshot, same price → skipped`, async () => {
        const h = harness({ snapshots: [snap(provider, 1599.99, 5 * 60 * 1000)] });
        const result = await h.view(provider, 1599.99);
        assert.equal(result.recorded, false);
        assert.equal(result.reason, 'fresh-unchanged');
        assert.deepEqual(h.history(provider), [1599.99]);
    });

    test(`[${provider}] 3. recent snapshot, price changed → recorded immediately`, async () => {
        const h = harness({ snapshots: [snap(provider, 1999.99, 5 * 60 * 1000)] });
        const result = await h.view(provider, 1599.99);
        assert.equal(result.recorded, true);
        assert.equal(result.reason, 'price-changed');
    });

    test(`[${provider}] 4. snapshot older than the stale window, same price → periodic snapshot`, async () => {
        const h = harness({ snapshots: [snap(provider, 1599.99, STALE_MS + 60 * 1000)] });
        const result = await h.view(provider, 1599.99);
        assert.equal(result.recorded, true);
        assert.equal(result.reason, 'stale');
        assert.deepEqual(h.history(provider), [1599.99, 1599.99]);
    });

    test(`[${provider}] 5. $1999.99 → $1599.99 puts the new point in the history after the old one`, async () => {
        const h = harness({ snapshots: [snap(provider, 1999.99, 30 * 60 * 1000)] });
        await h.view(provider, 1599.99);
        assert.deepEqual(h.history(provider), [1999.99, 1599.99]);
    });

    test(`[${provider}] 6. repeated views at $1599.99 add no duplicate snapshots while fresh`, async () => {
        const h = harness({ snapshots: [snap(provider, 1999.99, 30 * 60 * 1000)] });
        await h.view(provider, 1599.99);
        for (let i = 0; i < 5; i += 1) {
            h.clock.now += 10 * 60 * 1000; // a view every 10 minutes
            await h.view(provider, 1599.99);
        }
        assert.deepEqual(h.history(provider), [1999.99, 1599.99]);
    });

    test(`[${provider}] 6b. simultaneous views of a just-changed price write one snapshot, not several`, async () => {
        const h = harness({ snapshots: [snap(provider, 1999.99, 30 * 60 * 1000)] });
        const release = h.holdCreates();
        const views = [h.view(provider, 1599.99), h.view(provider, 1599.99), h.view(provider, 1599.99)];
        release();
        const results = await Promise.all(views);
        assert.equal(results.filter((r) => r.recorded).length, 1);
        assert.deepEqual(h.history(provider), [1999.99, 1599.99]);
    });
}

test('7/8. Amazon and Walmart are tracked independently for the same product id', async () => {
    const h = harness({ snapshots: [snap('walmart', 1599.99, 5 * 60 * 1000)] });
    // A fresh Walmart snapshot at the same price must not block Amazon's first one.
    const amazon = await h.view('amazon', 1599.99);
    const walmart = await h.view('walmart', 1599.99);
    assert.equal(amazon.reason, 'first');
    assert.equal(walmart.reason, 'fresh-unchanged');
});

test('a real price drop evaluates alerts at once, honouring threshold and cooldown', async () => {
    const alerts = [
        // threshold crossed, never notified → notified
        { _id: 'a1', provider: 'walmart', product_id: MACBOOK, threshold_price: 1700, last_notified_at: null, last_known_price: 1999.99 },
        // threshold not crossed → left alone
        { _id: 'a2', provider: 'walmart', product_id: MACBOOK, threshold_price: 1500, last_notified_at: null, last_known_price: 1999.99 },
        // crossed but notified an hour ago (inside the 24h cooldown) → left alone
        { _id: 'a3', provider: 'walmart', product_id: MACBOOK, threshold_price: 1800, last_notified_at: new Date(START - HOUR), last_known_price: 1999.99 }
    ];
    const h = harness({ snapshots: [snap('walmart', 1999.99, 30 * 60 * 1000)], alerts });

    const result = await h.view('walmart', 1599.99);

    assert.equal(result.alerts, 1);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'http://users.test/internal/price-drop');
    assert.equal(h.calls[0].init.headers['x-internal-auth'], 'test-internal');
    assert.deepEqual(h.calls[0].body, {
        alertId: 'a1',
        currentPrice: 1599.99,
        previousPrice: 1999.99,
        productUrl: `https://gateway.test/api/v1/walmart/products/${MACBOOK}`
    });
});

test('repeat views at the dropped price never re-run alert evaluation (no duplicate emails)', async () => {
    const alerts = [
        { _id: 'a1', provider: 'walmart', product_id: MACBOOK, threshold_price: 1700, last_notified_at: null, last_known_price: 1999.99 }
    ];
    const h = harness({ snapshots: [snap('walmart', 1999.99, 30 * 60 * 1000)], alerts });

    await h.view('walmart', 1599.99);
    for (let i = 0; i < 3; i += 1) {
        h.clock.now += 5 * 60 * 1000;
        await h.view('walmart', 1599.99);
    }

    assert.equal(h.calls.length, 1);
});

test('without INTERNAL_AUTH_SECRET the notify call carries no x-internal-auth (Users then refuses it)', async () => {
    const alerts = [
        { _id: 'a1', provider: 'walmart', product_id: MACBOOK, threshold_price: 1700, last_notified_at: null, last_known_price: 1999.99 }
    ];
    const h = harness({ snapshots: [snap('walmart', 1999.99, HOUR)], alerts, env: {} });
    await h.view('walmart', 1599.99);
    assert.equal(h.calls[0].init.headers['x-internal-auth'], undefined);
});

test('snapshotDecision compares whole cents, so float noise is not a price change', () => {
    const last = { price: 1599.99, snapshotted_at: new Date(START - 60 * 1000) };
    assert.equal(snapshotDecision(last, 1599.9900000001, { now: START, staleMs: STALE_MS }).snapshot, false);
    assert.equal(snapshotDecision(last, 1599.98, { now: START, staleMs: STALE_MS }).reason, 'price-changed');
    assert.equal(snapshotDecision(null, 1599.99, { now: START, staleMs: STALE_MS }).reason, 'first');
});
