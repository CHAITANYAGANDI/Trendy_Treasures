'use strict';

// ─── On-read price snapshots + price-drop alerts ──────────────────────────
//
// After a product-detail request flows through the gateway (and on each
// /internal/snapshot-tracked sweep), the price is recorded in
// price_snapshots — the Price History chart's data — and any price alerts
// it crosses are evaluated.
//
// Recording used to depend on age alone: a snapshot younger than the stale
// window blocked the next one, whatever the price was. So when a provider
// changed a price, the chart (and the price-drop alerts, which only run
// after a snapshot is written) kept the old price for up to six hours.
// The policy now is:
//
//     snapshot  if the price changed  OR  the latest snapshot is stale
//     skip      if the price is unchanged  AND  the latest snapshot is fresh
//
// A changed price is recorded at once. An unchanged one still produces one
// row per stale window, so a popular product doesn't get a row per view —
// and repeat views at the same price never re-run alert evaluation.
//
// Dependency-injected like tokenManager, so the policy can be tested
// without Mongo or a network. app.js owns the wiring; this file owns the
// policy.

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Prices are money: compare whole cents, so float noise in a far decimal
// never counts as a change.
const toCents = (price) => Math.round(Number(price) * 100);

// `last` is the newest snapshot ({ price, snapshotted_at }) or null.
const snapshotDecision = (last, price, { now, staleMs }) => {
    if (!last) return { snapshot: true, reason: 'first' };
    if (toCents(last.price) !== toCents(price)) return { snapshot: true, reason: 'price-changed' };
    const ageMs = now - new Date(last.snapshotted_at).getTime();
    if (ageMs > staleMs) return { snapshot: true, reason: 'stale' };
    return { snapshot: false, reason: 'fresh-unchanged' };
};

const createPriceRecorder = ({
    PriceSnapshot,
    PriceAlert,
    usersTarget,
    staleMs = DEFAULT_STALE_MS,
    notifyCooldownMs = DEFAULT_NOTIFY_COOLDOWN_MS,
    fetchImpl = (...args) => globalThis.fetch(...args),
    logger = console,
    env = process.env,
    now = () => Date.now()
} = {}) => {
    // Products being recorded right now. Two near-simultaneous views of a
    // just-changed price would otherwise both read the old snapshot and
    // both write. In-process is enough while the gateway runs as a single
    // instance (Cloud Run --max-instances 1), like its other caches.
    const inFlight = new Set();

    const notifyCrossedAlerts = async (provider, product_id, price, originalUrl, reqId) => {
        // Buyers whose threshold was crossed and who aren't in cooldown. The
        // internal handler re-checks the cooldown and updates
        // last_notified_at + last_known_price after sending.
        const cooldownCutoff = new Date(now() - notifyCooldownMs);
        const alerts = await PriceAlert.find({
            provider,
            product_id,
            threshold_price: { $gte: price },
            $or: [
                { last_notified_at: null },
                { last_notified_at: { $lt: cooldownCutoff } }
            ]
        });

        if (alerts.length === 0) return 0;
        logger.log(`[gateway] [${reqId}] 🔔 ${alerts.length} alert(s) triggered for ${provider}/${product_id}`);

        const headers = { 'Content-Type': 'application/json' };
        if (env.INTERNAL_AUTH_SECRET) {
            headers['x-internal-auth'] = env.INTERNAL_AUTH_SECRET;
        }

        // In parallel; each is independent and idempotent server-side, so one
        // failure doesn't affect the others.
        await Promise.allSettled(alerts.map((alert) =>
            fetchImpl(`${usersTarget}/internal/price-drop`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    alertId: String(alert._id),
                    currentPrice: price,
                    previousPrice: alert.last_known_price,
                    productUrl: originalUrl
                })
            }).then(async (r) => {
                if (!r.ok) {
                    const text = await r.text().catch(() => '');
                    logger.warn(`[gateway] [${reqId}] ✗ price-drop notify failed for alert=${alert._id}: ${r.status} ${text.slice(0, 100)}`);
                }
            }).catch((err) => {
                logger.warn(`[gateway] [${reqId}] ✗ price-drop notify threw for alert=${alert._id}: ${err.message}`);
            })
        ));
        return alerts.length;
    };

    // Resolves to { recorded, reason, alerts } — callers on the request path
    // ignore it (fire-and-forget); tests read it.
    const recordPriceAndEvaluateAlerts = async (provider, product, originalUrl, reqId) => {
        const { product_id, product_name, price } = product;
        const key = `${provider}:${product_id}`;
        if (inFlight.has(key)) return { recorded: false, reason: 'in-flight', alerts: 0 };
        inFlight.add(key);

        try {
            // Newest snapshot's price + time — one index hit on
            // { provider, product_id, snapshotted_at: -1 }.
            const last = await PriceSnapshot
                .findOne({ provider, product_id })
                .sort({ snapshotted_at: -1 })
                .select('price snapshotted_at');

            const decision = snapshotDecision(last, price, { now: now(), staleMs });
            if (!decision.snapshot) return { recorded: false, reason: decision.reason, alerts: 0 };

            await PriceSnapshot.create({ provider, product_id, product_name, price });
            logger.log(`[gateway] [${reqId}] 📷 Snapshot (${decision.reason}) — ${provider}/${product_id} @ $${price}`);

            const alerts = await notifyCrossedAlerts(provider, product_id, price, originalUrl, reqId);
            return { recorded: true, reason: decision.reason, alerts };
        } catch (err) {
            logger.error(`[gateway] [${reqId}] ✗ snapshot/evaluate failed for ${provider}/${product_id}:`, err.message);
            return { recorded: false, reason: 'error', alerts: 0 };
        } finally {
            inFlight.delete(key);
        }
    };

    return { recordPriceAndEvaluateAlerts };
};

module.exports = {
    createPriceRecorder,
    snapshotDecision,
    DEFAULT_STALE_MS,
    DEFAULT_NOTIFY_COOLDOWN_MS
};
