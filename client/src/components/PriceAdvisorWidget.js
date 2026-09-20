import React, { useEffect, useState } from 'react';
import { FaRobot } from 'react-icons/fa';
import { fetchPriceAdvice, apiErrorMessage } from '../utils';

// Compact "buy now or wait?" tile that sits next to the price history
// chart. Reads the same price_snapshots data the chart does, runs it
// through OpenAI for a 1–2 sentence recommendation. Falls back to a
// quiet disabled state if the server returns 503 (no OPENAI_API_KEY).
function PriceAdvisorWidget({ provider, productId }) {
    const [state, setState] = useState({ loading: true });

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

    return (
        <section className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/80 via-white to-white p-5">
            <header className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-brand-gradient text-white flex items-center justify-center text-sm shadow-sm shadow-brand-500/30">
                    <FaRobot />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-ink-900 leading-tight">AI price advisor</h3>
                    <p className="text-[11px] text-ink-500">Based on the last 30 days of snapshots</p>
                </div>
            </header>

            {state.loading ? (
                <p className="text-sm text-ink-500 animate-pulse">Analyzing price history…</p>
            ) : state.error ? (
                <p className="text-sm text-ink-500">{state.error}</p>
            ) : (
                <>
                    <p className="text-sm text-ink-800 leading-relaxed">{state.advice}</p>
                    {state.stats && (
                        <p className="mt-3 text-[11px] text-ink-500">
                            Current is at the <span className="font-semibold text-ink-700">{state.stats.percentile}th percentile</span>
                            {' '}of the 30d range
                            {' · '}
                            <span className="font-semibold text-ink-700">
                                {state.stats.trend30dPct >= 0 ? '+' : ''}{state.stats.trend30dPct}%
                            </span>{' '}in 30d
                        </p>
                    )}
                </>
            )}
        </section>
    );
}

export default PriceAdvisorWidget;
