import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Sheet } from './ui/Primitives';

/**
 * Custom replacement for the browser's native window.confirm. Listens to a
 * `center-confirm` custom event so any utility (showConfirm in utils.js) can
 * fire it without a React hook. The event carries a one-shot resolver that
 * returns the user's choice.
 *
 * Usage from outside React:
 *   const ok = await showConfirm({
 *     title: 'Delete this admin?',
 *     body: 'This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     danger: true
 *   });
 *   if (ok) { ...do the thing... }
 */
function ConfirmModal() {
    const [dialog, setDialog] = useState(null);

    const close = useCallback(
        (result) => {
            if (!dialog) return;
            dialog.resolve(result);
            setDialog(null);
        },
        [dialog]
    );

    useEffect(() => {
        const handler = (e) => {
            const { title, body, confirmLabel, cancelLabel, danger, resolve } = e.detail || {};
            if (typeof resolve !== 'function') return;
            setDialog({
                title: title || 'Are you sure?',
                body: body || '',
                confirmLabel: confirmLabel || 'Confirm',
                cancelLabel: cancelLabel || 'Cancel',
                danger: !!danger,
                resolve
            });
        };
        window.addEventListener('center-confirm', handler);
        return () => window.removeEventListener('center-confirm', handler);
    }, []);

    // Escape is handled by <Sheet>, which also traps focus and locks the
    // page behind. Enter-to-confirm is this dialog's own behaviour.
    useEffect(() => {
        if (!dialog) return undefined;
        const onKey = (e) => {
            if (e.key === 'Enter') close(true);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dialog, close]);

    const onCancel = useCallback(() => close(false), [close]);

    if (!dialog) return null;

    return (
        <Sheet
            open
            onClose={onCancel}
            labelledBy="confirm-title"
            describedBy={dialog.body ? 'confirm-body' : undefined}
        >
            <div className="flex items-start gap-4">
                <span
                    className={`w-11 h-11 shrink-0 rounded-fld grid place-items-center ${
                        dialog.danger ? 'bg-redWash text-red' : 'bg-haze text-ink'
                    }`}
                >
                    {dialog.danger ? (
                        <AlertTriangle size={19} aria-hidden="true" />
                    ) : (
                        <HelpCircle size={19} aria-hidden="true" />
                    )}
                </span>
                <div className="flex-1 min-w-0">
                    <h2 id="confirm-title" className="t-h4">
                        {dialog.title}
                    </h2>
                    {dialog.body && (
                        <p id="confirm-body" className="t-ui dim mt-2 leading-relaxed">
                            {dialog.body}
                        </p>
                    )}
                </div>
            </div>

            {/* Initial focus is handled by <Sheet>, which lands on Cancel —
                the safe default on a destructive confirm. Enter still
                confirms, exactly as before. */}
            <div className="mt-7 flex gap-2.5">
                <button
                    type="button"
                    onClick={onCancel}
                    className="btn btn-quiet btn-lg flex-1"
                >
                    {dialog.cancelLabel}
                </button>
                <button
                    type="button"
                    onClick={() => close(true)}
                    className={`btn btn-lg flex-1 ${
                        dialog.danger ? 'btn-danger-solid' : 'btn-blue'
                    }`}
                >
                    {dialog.confirmLabel}
                </button>
            </div>
        </Sheet>
    );
}

export default ConfirmModal;
