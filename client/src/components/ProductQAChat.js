import React, { useRef, useState } from 'react';
import { MessageSquareText, ArrowUp } from 'lucide-react';
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
function ProductQAChat({
    provider,
    productId,
    productName,
    productDescription,
    productFeatures,
    productPrice,
    bare = false,
    onUnavailable
}) {
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
            // Tell the page, so it doesn't keep offering a way in.
            if (onUnavailable) onUnavailable();
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

    // `bare` drops the bordered card and its luminous rule, for when the
    // surface around it already carries both.
    return (
        <section className={bare ? '' : 'ai'}>
            <header className="flex items-center gap-2.5">
                <span className="ai-glyph">
                    <MessageSquareText size={15} aria-hidden="true" />
                </span>
                <div>
                    <h3 className="ai-title">Ask about this product</h3>
                    <p className="ai-sub">Grounded in the product's listing — won't make up facts.</p>
                </div>
            </header>

            {exchanges.length === 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTED.map((s) => (
                        <button key={s} type="button" onClick={() => submit(s)} className="chip">
                            {s}
                        </button>
                    ))}
                </div>
            ) : (
                <div
                    ref={scrollRef}
                    className={`mt-5 flex flex-col gap-3 ${
                        bare ? '' : 'max-h-[320px] overflow-y-auto pr-1 -mr-1'
                    }`}
                >
                    {exchanges.map((ex, i) => (
                        <React.Fragment key={i}>
                            <p className="bubble bubble-me">{ex.q}</p>
                            {ex.a ? (
                                <p className="bubble bubble-them">{ex.a}</p>
                            ) : ex.error ? (
                                <p className="bubble bubble-err">{ex.error}</p>
                            ) : (
                                <p className="bubble bubble-them">
                                    <span className="ai-shimmer">Thinking…</span>
                                </p>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            )}

            <form
                onSubmit={(e) => { e.preventDefault(); submit(question); }}
                className="mt-5"
            >
                <div className="flex items-center gap-2">
                    <label className="search flex-1 !h-11 !rounded-fld">
                        <span className="sr-only">Ask about this product</span>
                        <input
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="Ask anything about this product…"
                            maxLength={QUESTION_MAX_LEN}
                            disabled={pending}
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={!question.trim() || pending}
                        className="btn btn-blue !w-11 !h-11 !p-0 !rounded-full"
                        aria-label="Send question"
                    >
                        <ArrowUp size={18} aria-hidden="true" />
                    </button>
                </div>
                {question.length > QUESTION_MAX_LEN * 0.8 && (
                    <p className={`field-hint text-right ${remaining < 0 ? 'field-hint-bad' : ''}`}>
                        {remaining} characters left
                    </p>
                )}
            </form>
        </section>
    );
}

export default ProductQAChat;
