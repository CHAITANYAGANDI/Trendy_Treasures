import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchPriceAdvice, apiErrorMessage } from '../utils';

// 1st / 2nd / 3rd / 4th. The value itself is unchanged — this only picks
// the suffix, so a 21st-percentile price no longer reads "21th".
const ordinal = (n) => {
    const value = Number(n);
    if (!Number.isFinite(value)) return `${n}th`;
    const mod100 = Math.abs(value) % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    const mod10 = Math.abs(value) % 10;
    if (mod10 === 1) return `${value}st`;
    if (mod10 === 2) return `${value}nd`;
    if (mod10 === 3) return `${value}rd`;
    return `${value}th`;
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
                    <p className="ai-sub">Based on the last 30 days of snapshots</p>
                </div>
            </header>

            <div className="mt-5">
                {state.loading ? (
                    <p className="ai-shimmer">Analyzing price history…</p>
                ) : state.error ? (
                    <p className="t-ui dim">{state.error}</p>
                ) : (
                    <>
                        <p className="ai-verdict">{state.advice}</p>
                        {state.stats && (
                            <p className="ai-stat mt-4">
                                Current is at the{' '}
                                <b>{ordinal(state.stats.percentile)} percentile</b> of the 30d
                                range {' · '}
                                <b>
                                    {state.stats.trend30dPct >= 0 ? '+' : ''}
                                    {state.stats.trend30dPct}%
                                </b>{' '}
                                in 30d
                            </p>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

export default PriceAdvisorWidget;
