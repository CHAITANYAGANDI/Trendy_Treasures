import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchPriceAdvice, apiErrorMessage } from '../utils';

const shortDate = (d) => {
    const date = new Date(d);
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

// The server's stats in words a shopper would use — "close to the lowest
// price we've seen" rather than "the 18th percentile of the 30d range".
// Returns [{ strong, rest }] phrases, or null when there's too little
// history to describe (the advice sentence already says so).
export const describePriceStats = (stats) => {
    if (!stats || !(stats.sampleCount >= 3)) return null;

    const date = shortDate(stats.firstSnapshotAt);
    const since = date ? ` since ${date}` : ' in the last 30 days';

    // A price that never moved used to read "0th percentile", which sounds
    // like "cheapest" when it really means "unchanged".
    if (stats.max === stats.min) {
        return [{ strong: 'No price change', rest: since }];
    }

    const seen = " we've seen in the last 30 days";
    let position;
    if (stats.current <= stats.min) position = { strong: 'Lowest price', rest: seen };
    else if (stats.current >= stats.max) position = { strong: 'Highest price', rest: seen };
    else if (stats.percentile <= 25) position = { strong: 'Close to the lowest price', rest: seen };
    else if (stats.percentile >= 75) position = { strong: 'Close to the highest price', rest: seen };
    else position = { strong: 'About the usual price', rest: ' for the last 30 days' };

    const pct = stats.trend30dPct;
    const change =
        pct === 0
            ? { strong: 'Same price', rest: date ? ` as on ${date}` : ' as 30 days ago' }
            : { strong: `${pct < 0 ? 'Down' : 'Up'} ${Math.abs(pct)}%`, rest: since };

    return [position, change];
};

// Compact "buy now or wait?" panel that sits beneath the price history
// chart. Reads the same price_snapshots data the chart does, runs it
// through OpenAI for a 1–2 sentence recommendation. Renders nothing at all
// if the server returns 503 (no OPENAI_API_KEY).
//
// The two-pixel luminous rule along the top marks generated text. It
// appears here and on the grounded Q&A, and nowhere else in the product.
function PriceAdvisorWidget({ provider, productId, bare = false, onUnavailable }) {
    const [state, setState] = useState({ loading: true });

    // Held in a ref so an inline callback from the parent cannot retrigger
    // the fetch. The effect still depends only on the product it is about.
    const onUnavailableRef = useRef(onUnavailable);
    onUnavailableRef.current = onUnavailable;

    useEffect(() => {
        let cancelled = false;
        setState({ loading: true });
        fetchPriceAdvice(provider, productId).then((res) => {
            if (cancelled) return;
            if (res.ok && res.success) {
                setState({ loading: false, advice: res.advice, stats: res.stats });
            } else if (res.status === 503 && /unconfigured/i.test(res.message || '')) {
                // API key not set — render nothing. Other 503 causes
                // (timeout, OpenAI upstream error) fall through to the
                // error branch so they're visible.
                setState({ loading: false, disabled: true });
                // Tell the page, so it doesn't offer a way in to a surface
                // that has nothing to show.
                onUnavailableRef.current?.();
            } else {
                // Was `res.message || 'Could not load advice.'`, but a
                // throttled or edge-rejected request has no JSON body at all,
                // so it always fell through to the hardcoded string and told
                // the shopper nothing about why or whether to retry.
                // Shoppers get a clean sentence; the reason code the server
                // sent ("AI advice unavailable: upstream_error") stays in the
                // console where it's actually useful.
                console.warn('[client] price advice failed', res.status, res.message || '');
                setState({
                    loading: false,
                    error: apiErrorMessage(res, 'Could not load advice.')
                });
            }
        });
        return () => { cancelled = true; };
    }, [provider, productId]);

    if (state.disabled) return null;

    const phrases = describePriceStats(state.stats);

    // `bare` drops the bordered card and its luminous rule, for when the
    // surface around it already carries both.
    return (
        <section className={bare ? '' : 'ai'}>
            <header className="flex items-center gap-2.5">
                <span className="ai-glyph">
                    <Sparkles size={15} aria-hidden="true" />
                </span>
                <div>
                    <h3 className="ai-title">AI price advisor</h3>
                    <p className="ai-sub">Based on this item's prices over the last 30 days</p>
                </div>
            </header>

            <div className="mt-5">
                {state.loading ? (
                    <p className="ai-shimmer">Checking recent prices…</p>
                ) : state.error ? (
                    <p className="t-ui dim">{state.error}</p>
                ) : (
                    <>
                        <p className="ai-verdict">{state.advice}</p>
                        {phrases && (
                            <p className="ai-stat mt-4">
                                {phrases.map((phrase, i) => (
                                    <React.Fragment key={phrase.strong}>
                                        {i > 0 && ' · '}
                                        <b>{phrase.strong}</b>
                                        {phrase.rest}
                                    </React.Fragment>
                                ))}
                            </p>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

export default PriceAdvisorWidget;
