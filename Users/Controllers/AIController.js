const PriceSnapshot = require('../Models/PriceSnapshot');
const { callOpenAI } = require('../Services/AIService');

const VALID_PROVIDERS = new Set(['amazon', 'walmart']);

// ─── In-memory caches ──────────────────────────────────────────────────
//
// Price advice is deterministic-ish given the same history rows, so it's
// cached — trimming the OpenAI bill ~50–100x for hot products. An entry
// is only reused for the exact history it was computed from: the gateway
// records a changed price at once (not just every 6h), and an age-only
// cache kept showing the old price for hours after a change.
//
// Q&A is not cached — questions vary per buyer, and embedding-style
// similarity caching is more complexity than it's worth at this scale.

const PRICE_ADVICE_TTL_MS = 6 * 60 * 60 * 1000;
const priceAdviceCache = new Map();

// Identifies the history an answer was computed from. A new snapshot (or
// an old one sliding out of the 30-day window) changes it.
const historyFingerprint = (snapshots) => {
    const last = snapshots[snapshots.length - 1];
    return `${snapshots.length}:${new Date(last.snapshotted_at).getTime()}:${last.price}`;
};


// Statistical pre-computation we hand to the model. Doing the math in
// code (instead of in the prompt) makes the model's job easier, the
// answer more accurate, and the prompt shorter (== cheaper).
const summarizeHistory = (snapshots) => {
    if (snapshots.length === 0) return null;
    const prices = snapshots.map((s) => s.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const current = prices[prices.length - 1];
    const median = [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    // Percentile of current price within the observed range. 0 = at the
    // historical low, 100 = at the historical high.
    const range = max - min || 1;
    const percentile = Math.round(((current - min) / range) * 100);
    const trend30dPct = prices.length >= 2
        ? Math.round(((current - prices[0]) / prices[0]) * 100)
        : 0;
    return {
        sampleCount: prices.length,
        first: Number(prices[0].toFixed(2)),
        current: Number(current.toFixed(2)),
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
        median: Number(median.toFixed(2)),
        mean: Number(mean.toFixed(2)),
        percentile,
        trend30dPct,
        firstSnapshotAt: snapshots[0].snapshotted_at,
        lastSnapshotAt: snapshots[snapshots.length - 1].snapshotted_at
    };
};

// "Sep 3" — fixed locale and UTC so the prompt doesn't depend on where the
// server happens to run.
const shortDate = (d) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// The stats restated the way a shopper would say them. The model mirrors
// the vocabulary it's given, so feeding it "percentile" and "30d" got
// those words straight back into customer-facing advice.
const describeForShopper = (stats) => {
    const since = shortDate(stats.firstSnapshotAt);
    if (stats.max === stats.min) {
        return [`- The price has not changed since we started watching it on ${since}.`];
    }

    let position;
    if (stats.current <= stats.min) position = 'the lowest price we have seen';
    else if (stats.current >= stats.max) position = 'the highest price we have seen';
    else if (stats.percentile <= 25) position = 'close to the lowest price we have seen';
    else if (stats.percentile >= 75) position = 'close to the highest price we have seen';
    else position = 'about the usual price';

    const pct = stats.trend30dPct;
    const change = pct === 0
        ? `about the same as when we started watching it on ${since}`
        : `${pct < 0 ? 'down' : 'up'} ${Math.abs(pct)}% since we started watching it on ${since}`;

    return [`- Today's price is ${position}.`, `- It is ${change}.`];
};

// Shown instead of calling the model when there's too little history to
// say anything useful.
const tooEarlyAdvice = (stats) => {
    let soFar = '';
    if (stats) {
        const now = `$${stats.current.toFixed(2)}`;
        // Even two points can show a real move — say so rather than
        // reading as if the price had never changed.
        soFar = stats.first === stats.current
            ? ` — it's ${now} so far`
            : ` — it's ${now} now, ${stats.current < stats.first ? 'down' : 'up'} from $${stats.first.toFixed(2)}`;
    }
    return `We've only just started watching this price${soFar}. Check back in a few days and we'll tell you whether it's a good time to buy.`;
};


// GET /ai/price-advice/:provider/:productId
// Reads the last 30 days of price_snapshots, asks the model for a brief
// buy-now/wait recommendation. Public — no auth needed (chart is public
// too, this is just commentary on the same data).
const priceAdvice = async (req, res) => {
    try {
        const { provider, productId } = req.params;
        if (!VALID_PROVIDERS.has(provider) || !productId) {
            return res.status(400).json({ success: false, message: 'Invalid input' });
        }

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const snapshots = await PriceSnapshot
            .find({ provider, product_id: productId, snapshotted_at: { $gte: since } })
            .sort({ snapshotted_at: 1 })
            .select('price snapshotted_at -_id');

        // Reuse an answer only for the same history (the cheap indexed read
        // above is what makes that check possible; the model call is the
        // expensive part the cache exists to save).
        const cacheKey = `${provider}:${productId}`;
        const fingerprint = snapshots.length ? historyFingerprint(snapshots) : null;
        const cached = priceAdviceCache.get(cacheKey);
        if (cached && cached.fingerprint === fingerprint && Date.now() - cached.fetchedAt < PRICE_ADVICE_TTL_MS) {
            return res.status(200).json({ success: true, advice: cached.advice, stats: cached.stats, cached: true });
        }

        if (snapshots.length === 0) {
            return res.status(200).json({
                success: true,
                advice: tooEarlyAdvice(null),
                stats: null,
                cached: false
            });
        }

        const stats = summarizeHistory(snapshots);

        // Fewer than 3 snapshots = no real trend. Skip the model call,
        // return a fixed message — we'd just be paying OpenAI to say
        // "check back later" in different words.
        if (stats.sampleCount < 3) {
            const advice = tooEarlyAdvice(stats);
            priceAdviceCache.set(cacheKey, { advice, stats, fingerprint, fetchedAt: Date.now() });
            return res.status(200).json({ success: true, advice, stats, cached: false });
        }

        const system = [
            'You are a friendly shopping helper talking to an everyday shopper, not an analyst.',
            'In 1–2 short sentences, tell them whether now is a good time to buy this product or whether waiting could get them a better price.',
            'Use plain, everyday words. Never use statistical or technical terms such as percentile, median, mean, snapshot, data point, sample, range or trend,',
            'and never abbreviate time periods — write "the last 30 days", not "30d".',
            'You may mention a price or two in dollars and a simple change like "down 12%".',
            'Do not say "based on the data", do not use emojis, and do not greet the user. Output is shown as plain text in a small panel.'
        ].join(' ');

        const user = [
            'What we have seen for this product over the last 30 days:',
            `- Price today: $${stats.current.toFixed(2)}`,
            `- Lowest price: $${stats.min.toFixed(2)}`,
            `- Highest price: $${stats.max.toFixed(2)}`,
            `- Usual price: $${stats.median.toFixed(2)}`,
            ...describeForShopper(stats)
        ].join('\n');

        const result = await callOpenAI({ system, user, maxTokens: 80, temperature: 0.2 });
        if (!result.ok) {
            return res.status(503).json({
                success: false,
                message: `AI advice unavailable: ${result.reason}`,
                stats
            });
        }

        priceAdviceCache.set(cacheKey, { advice: result.content, stats, fingerprint, fetchedAt: Date.now() });
        return res.status(200).json({ success: true, advice: result.content, stats, cached: false });
    } catch (error) {
        console.error('priceAdvice error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to generate price advice' });
    }
};


// POST /ai/product-qa
// Grounded Q&A: the client posts product metadata + a question, the model
// answers strictly from that context. Public — buyer doesn't need to be
// logged in to ask. Strict input caps + a system rule against fabricating
// keep this from being weaponized as a free general-purpose chatbot.
const QUESTION_MAX_LEN = 240;
const DESC_MAX_LEN = 2000;

const productQA = async (req, res) => {
    try {
        const {
            product_name,
            product_description,
            product_features,
            product_price,
            question
        } = req.body || {};

        if (typeof product_name !== 'string' || product_name.length === 0 ||
            typeof question !== 'string' || question.length === 0) {
            return res.status(400).json({ success: false, message: 'product_name and question are required' });
        }
        if (question.length > QUESTION_MAX_LEN) {
            return res.status(400).json({ success: false, message: `Question must be ${QUESTION_MAX_LEN} characters or fewer.` });
        }

        const features = Array.isArray(product_features) ? product_features.slice(0, 20) : [];
        const desc = typeof product_description === 'string'
            ? product_description.slice(0, DESC_MAX_LEN)
            : '';

        const system = [
            'You answer shopper questions about ONE specific product, using ONLY the product information provided.',
            'If the answer is not in the provided information, say "I don\'t see that detail in this product\'s listing." and suggest the buyer check the listing or contact the seller.',
            'Be concise: 1–3 sentences. No greetings, no emojis, no bullet points unless the question explicitly asks for a list.',
            'Never invent specifications, dimensions, warranty terms, or compatibility claims that aren\'t stated.',
            'Never answer questions unrelated to this product.'
        ].join(' ');

        const userMsg = [
            `PRODUCT NAME: ${product_name}`,
            typeof product_price === 'number' ? `LISTED PRICE: $${product_price.toFixed(2)}` : null,
            features.length ? `FEATURES:\n${features.map((f) => `- ${f}`).join('\n')}` : null,
            desc ? `DESCRIPTION:\n${desc}` : null,
            '---',
            `QUESTION: ${question}`
        ].filter(Boolean).join('\n\n');

        const result = await callOpenAI({ system, user: userMsg, maxTokens: 220, temperature: 0.2 });
        if (!result.ok) {
            return res.status(503).json({
                success: false,
                message: `AI Q&A unavailable: ${result.reason}`
            });
        }

        return res.status(200).json({ success: true, answer: result.content });
    } catch (error) {
        console.error('productQA error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to answer question' });
    }
};


module.exports = { priceAdvice, productQA };
