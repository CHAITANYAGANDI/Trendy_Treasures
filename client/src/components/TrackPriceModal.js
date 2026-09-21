import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { createPriceAlert, handleError, handleSuccess } from '../utils';
import { Sheet } from './ui/Primitives';

// Modal where a logged-in buyer sets a threshold price for a product.
// Pre-fills threshold to currentPrice (rounded down to the nearest dollar)
// so the buyer just has to confirm or tweak.
function TrackPriceModal({ open, onClose, provider, productId, productName, currentPrice }) {
    const initialThreshold = currentPrice
        ? Math.max(1, Math.floor(currentPrice * 0.95))
        : '';
    const [threshold, setThreshold] = useState(initialThreshold);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) setThreshold(initialThreshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, currentPrice]);

    const num = Number(threshold);
    const isValid = Number.isFinite(num) && num > 0 && num <= 1_000_000;

    const submit = async (e) => {
        e.preventDefault();
        if (!isValid || submitting) return;
        setSubmitting(true);
        try {
            const res = await createPriceAlert({
                provider,
                product_id: productId,
                product_name: productName,
                threshold_price: num,
                last_known_price: Number(currentPrice) || num
            });
            if (res.ok) {
                handleSuccess(`Tracking ${productName}. We'll email you when it drops to $${num.toFixed(2)} or below.`);
                onClose();
            } else {
                const data = await res.json().catch(() => ({}));
                handleError(data.message || 'Failed to create alert.');
            }
        } catch (err) {
            handleError(err.message || 'Failed to create alert.');
        } finally {
            setSubmitting(false);
        }
    };

    // Escape, the backdrop, the focus trap and the scroll lock all come
    // from <Sheet>, the same one the confirm dialog uses.
    return (
        <Sheet open={open} onClose={onClose} labelledBy="track-price-title">
            <form onSubmit={submit}>
                <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-fld bg-haze grid place-items-center shrink-0">
                        <Bell size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h2 id="track-price-title" className="t-h4">Track this price</h2>
                        <p className="text-cap dimmer mt-0.5">We'll email you when it drops.</p>
                    </div>
                </div>

                <div className="mt-6 pt-5 border-t border-hairlineSoft">
                    <p className="text-cap dimmer">Currently</p>
                    <p className="t-d3 tnum mt-1">${Number(currentPrice || 0).toFixed(2)}</p>
                    <p className="t-ui dim mt-1 truncate">{productName}</p>
                </div>

                <label htmlFor="threshold" className="block t-ui font-medium mt-6">
                    Notify me when price drops to
                </label>
                <div className="relative mt-2">
                    <span
                        className="absolute left-4 top-1/2 -translate-y-1/2 dim pointer-events-none"
                        aria-hidden="true"
                    >
                        $
                    </span>
                    <input
                        id="threshold"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0.01"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        placeholder="0.00"
                        autoFocus
                        aria-invalid={!isValid && threshold !== '' ? 'true' : undefined}
                        className={`w-full h-12 pl-8 pr-4 rounded-fld border bg-paper text-body tnum font-medium outline-none transition-[border-color,box-shadow] focus:border-blue focus:shadow-ring ${
                            !isValid && threshold !== '' ? 'border-red' : 'border-hairline'
                        }`}
                    />
                </div>

                {!isValid && threshold !== '' && (
                    <p className="field-hint field-hint-bad">Enter a positive amount.</p>
                )}

                <p className="field-hint">
                    You'll get at most one email per drop — no re-notifications within 24 hours.
                </p>

                <div className="mt-6 flex gap-2.5">
                    <button type="button" onClick={onClose} className="btn btn-quiet btn-lg flex-1">
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid || submitting}
                        className="btn btn-blue btn-lg flex-1"
                    >
                        {submitting ? 'Saving…' : 'Track price'}
                    </button>
                </div>
            </form>
        </Sheet>
    );
}

export default TrackPriceModal;
