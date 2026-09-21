import React, { useEffect, useState } from 'react';
import { Check, X, Info } from 'lucide-react';

/**
 * Glass pill toast, pinned to the top centre of the window and clear of
 * the 56px sticky header. Listens to a `center-toast` custom event so
 * utility functions outside the React tree can fire it — the event name is
 * part of the bus in utils.js and is left alone.
 */
function CenterToast() {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const handler = (e) => {
            const { id, message, kind } = e.detail || {};
            if (!message) return;
            setToasts((prev) => [...prev, { id, message, kind, leaving: false }]);

            const dismissAfter = kind === 'error' ? 2800 : 1800;
            setTimeout(() => {
                setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
            }, dismissAfter);
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, dismissAfter + 280);
        };
        window.addEventListener('center-toast', handler);
        return () => window.removeEventListener('center-toast', handler);
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div
            aria-live="polite"
            className="fixed inset-x-0 top-0 z-[9999] pointer-events-none flex flex-col items-center gap-3 px-4 pt-[72px]"
        >
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className={`toast ${t.leaving ? 'animate-toastOut' : 'animate-toastIn'}`}
                >
                    <span
                        className={`toast-dot ${
                            t.kind === 'error'
                                ? 'toast-dot-bad'
                                : t.kind === 'info'
                                  ? 'toast-dot-info'
                                  : ''
                        }`}
                    >
                        {t.kind === 'error' ? (
                            <X size={12} aria-hidden="true" />
                        ) : t.kind === 'info' ? (
                            <Info size={12} aria-hidden="true" />
                        ) : (
                            <Check size={12} aria-hidden="true" />
                        )}
                    </span>
                    <span>{t.message}</span>
                </div>
            ))}
        </div>
    );
}

export default CenterToast;
