import React, { useRef, useState } from 'react';
import { FaPaperPlane, FaRobot, FaUser } from 'react-icons/fa';
import { askProductQuestion, apiErrorMessage } from '../utils';

const SUGGESTED = [
    'Is this good for everyday use?',
    'What materials is it made of?',
    'Will this fit a small space?'
];
const QUESTION_MAX_LEN = 240;

// Stateless chat panel: each question is independent (no conversation
// history sent to the model). Keeps cost low and matches the grounded-
// QA mental model — the model is answering "about this product" not
// "remember what I asked you 3 questions ago."
function ProductQAChat({ provider, productId, productName, productDescription, productFeatures, productPrice }) {
    const [question, setQuestion] = useState('');
    const [exchanges, setExchanges] = useState([]); // [{ q, a, error? }]
    const [pending, setPending] = useState(false);
    const [disabled, setDisabled] = useState(false);
    const scrollRef = useRef(null);

    if (disabled) return null;

    const submit = async (raw) => {
        const q = (raw || '').trim();
        if (!q || pending) return;
        if (q.length > QUESTION_MAX_LEN) return;

        // Optimistic render — show the question immediately with a typing
        // shimmer so the UI feels responsive even though the API call
        // takes a few seconds.
        setExchanges((prev) => [...prev, { q, a: null }]);
        setQuestion('');
        setPending(true);

        const res = await askProductQuestion({
            provider,
            productId,
            product_name: productName,
            product_description: productDescription,
            product_features: productFeatures,
            product_price: productPrice,
            question: q
        });

        setPending(false);

        // Only auto-hide for the "API key not set" case — that's the one
        // 503 where retrying is pointless until the operator fixes env.
        // Transient failures (OpenAI rate-limit, timeout, network) should
        // surface the error inline so the buyer can retry.
        if (res.status === 503 && /unconfigured/i.test(res.message || '')) {
            setDisabled(true);
            return;
        }

        setExchanges((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.a === null) {
                if (res.ok && res.success) {
                    last.a = res.answer;
                } else {
                    // Same fix as PriceAdvisorWidget: a throttled or
                    // edge-rejected request carries no JSON body, so the old
                    // `res.message ||` fallback always won and "Try again"
                    // was advice the shopper couldn't act on.
                    console.warn('[client] product Q&A failed', res.status, res.message || '');
                    last.error = apiErrorMessage(res, 'Could not get an answer. Try again.');
                }
            }
            return next;
        });

        // Scroll to the latest answer on the next tick — exchanges have
        // already rendered by then.
        requestAnimationFrame(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        });
    };

    const remaining = QUESTION_MAX_LEN - question.length;

    return (
        <section className="rounded-2xl border border-ink-100 bg-white/90 p-5">
            <header className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-brand-gradient text-white flex items-center justify-center text-sm shadow-sm shadow-brand-500/30">
                    <FaRobot />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-ink-900 leading-tight">Ask about this product</h3>
                    <p className="text-[11px] text-ink-500">Grounded in the product's listing — won't make up facts.</p>
                </div>
            </header>

            {exchanges.length === 0 ? (
                <div className="space-y-2">
                    <p className="text-xs text-ink-500 uppercase tracking-wider font-semibold">Try:</p>
                    <div className="flex flex-wrap gap-2">
                        {SUGGESTED.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => submit(s)}
                                className="px-3 py-1.5 text-xs rounded-full bg-ink-100 hover:bg-brand-100 text-ink-700 hover:text-brand-700 transition-colors"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div
                    ref={scrollRef}
                    className="space-y-3 max-h-[320px] overflow-y-auto pr-2 -mr-2"
                >
                    {exchanges.map((ex, i) => (
                        <div key={i} className="space-y-2">
                            <div className="flex items-start gap-2">
                                <span className="w-6 h-6 rounded-full bg-ink-200 text-ink-600 flex items-center justify-center text-[11px] shrink-0">
                                    <FaUser />
                                </span>
                                <p className="text-sm text-ink-800 leading-relaxed">{ex.q}</p>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="w-6 h-6 rounded-full bg-brand-gradient text-white flex items-center justify-center text-[11px] shrink-0">
                                    <FaRobot />
                                </span>
                                {ex.a ? (
                                    <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-line">{ex.a}</p>
                                ) : ex.error ? (
                                    <p className="text-sm text-red-600">{ex.error}</p>
                                ) : (
                                    <p className="text-sm text-ink-400 italic animate-pulse">Thinking…</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <form
                onSubmit={(e) => { e.preventDefault(); submit(question); }}
                className="mt-4 flex items-end gap-2"
            >
                <div className="flex-1">
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Ask anything about this product…"
                        maxLength={QUESTION_MAX_LEN}
                        disabled={pending}
                        className="w-full px-4 py-2.5 rounded-full bg-white border border-ink-200/80 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-400 focus:shadow-focus"
                    />
                    {question.length > QUESTION_MAX_LEN * 0.8 && (
                        <p className={`mt-1 text-[10px] text-right ${remaining < 0 ? 'text-red-600' : 'text-ink-500'}`}>
                            {remaining} characters left
                        </p>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={!question.trim() || pending}
                    className="btn-primary !py-2.5 !px-4"
                    aria-label="Send question"
                >
                    <FaPaperPlane />
                </button>
            </form>
        </section>
    );
}

export default ProductQAChat;
