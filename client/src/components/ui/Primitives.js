import React, { useCallback, useEffect, useId, useRef } from 'react';
import { Star } from 'lucide-react';

/**
 * The controls the application actually uses, in the redesigned language.
 * Nothing here introduces behaviour — each one is the visual half of a
 * control that already existed somewhere in client/src.
 */

/* ── Activity indicator ────────────────────────────────────────────────
   A quarter arc in the accent blue travelling around a hairline track —
   the same two colours the rest of the interface is built from. */
export function Spinner({ size = 28, className = '' }) {
    return (
        <svg
            className={`spinner ${className}`}
            width={size}
            height={size}
            viewBox="0 0 44 44"
            role="status"
            aria-label="Loading"
        >
            <circle className="spinner-track" cx="22" cy="22" r="18" />
            <circle className="spinner-arc" cx="22" cy="22" r="18" />
        </svg>
    );
}

/* ── Rating ────────────────────────────────────────────────────────────
   The star count is derived from the product id by productMeta.js; this
   only draws it. */
export function Stars({ rating, size = 13 }) {
    const filled = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
    return (
        <span className="stars" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
                <Star
                    key={i}
                    size={size}
                    className={i <= filled ? 'on' : undefined}
                    fill="currentColor"
                    strokeWidth={0}
                />
            ))}
        </span>
    );
}

/* ── Segmented control ─────────────────────────────────────────────────
   Used for the home seller filter, the chart ranges and the user-role
   filter. `options` is [{ id, label }]. */
export function Segmented({ options, value, onChange, size, label }) {
    return (
        <div
            className={`segmented ${size === 'lg' ? 'segmented-lg' : ''}`}
            role="tablist"
            aria-label={label}
        >
            {options.map((opt) => (
                <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={value === opt.id}
                    onClick={() => onChange(opt.id)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

/* ── Pop-up button ─────────────────────────────────────────────────────
   A real <select>, styled. The application uses a select for sort and for
   quantity and both stay selects. */
export function Select({ value, onChange, children, size, className = '', ...rest }) {
    return (
        <span className={`select ${size === 'lg' ? 'select-lg' : ''} ${className}`}>
            <select value={value} onChange={onChange} {...rest}>
                {children}
            </select>
        </span>
    );
}

/** Quantity is a 1–10 select everywhere it appears. Never a stepper. */
export function QuantitySelect({ value, onChange, id, ariaLabel = 'Quantity', size }) {
    return (
        <Select id={id} value={value} onChange={onChange} size={size} aria-label={ariaLabel}>
            {[...Array(10).keys()].map((n) => (
                <option key={n + 1} value={n + 1}>
                    {n + 1}
                </option>
            ))}
        </Select>
    );
}

/* ── Text field with a floating label ──────────────────────────────────
   The input precedes the label in the DOM so `input:focus + label` can
   raise it. `className` lands on the .field box itself (not the wrapper)
   so a modifier like `field-dark` can reach the input.  */
export function Field({
    id,
    label,
    value,
    onChange,
    type = 'text',
    hint,
    hintBad,
    error,
    trailing,
    className = '',
    wrapClassName = '',
    ...rest
}) {
    const generated = useId();
    const inputId = id || generated;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const filled = value !== undefined && value !== null && String(value) !== '';

    return (
        <div className={wrapClassName}>
            <div
                className={[
                    'field',
                    filled ? 'field-filled' : '',
                    error ? 'field-error' : '',
                    className,
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                <input
                    id={inputId}
                    type={type}
                    value={value}
                    onChange={onChange}
                    placeholder=" "
                    aria-describedby={hintId}
                    aria-invalid={error ? 'true' : undefined}
                    {...rest}
                />
                <label htmlFor={inputId}>{label}</label>
                {trailing}
            </div>
            {hint && (
                <p id={hintId} className={`field-hint ${hintBad ? 'field-hint-bad' : ''}`}>
                    {hint}
                </p>
            )}
        </div>
    );
}

/* ── 4-digit passcode ──────────────────────────────────────────────────
   Four boxes over one string value, so the component above keeps the exact
   same `otp` state it had when this was a single text input. Pasting a code
   spreads it across the boxes; backspace on an empty box steps back. */
export function Passcode({ value = '', onChange, length = 4, autoFocus, ariaLabel = 'Verification code' }) {
    const refs = useRef([]);
    const digits = String(value).padEnd(length, ' ').slice(0, length).split('');

    const setAt = (index, digit) => {
        const next = digits.map((d) => (d === ' ' ? '' : d));
        next[index] = digit;
        onChange(next.join('').replace(/\s/g, ''));
    };

    const handleChange = (index) => (e) => {
        const typed = e.target.value.replace(/[^0-9]/g, '');
        if (!typed) {
            setAt(index, '');
            return;
        }
        if (typed.length > 1) {
            // A paste, or a fast typist. Spread it from here onward.
            const spread = String(value).slice(0, index) + typed;
            onChange(spread.replace(/[^0-9]/g, '').slice(0, length));
            const landed = Math.min(index + typed.length, length - 1);
            refs.current[landed]?.focus();
            return;
        }
        setAt(index, typed);
        if (index < length - 1) refs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index) => (e) => {
        if (e.key === 'Backspace' && !digits[index].trim() && index > 0) {
            e.preventDefault();
            refs.current[index - 1]?.focus();
            setAt(index - 1, '');
        }
        if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
        if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
    };

    return (
        <div className="passcode" role="group" aria-label={ariaLabel}>
            {digits.map((digit, i) => (
                <input
                    key={i}
                    ref={(el) => {
                        refs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={length}
                    value={digit.trim()}
                    onChange={handleChange(i)}
                    onKeyDown={handleKeyDown(i)}
                    onFocus={(e) => e.target.select()}
                    autoFocus={autoFocus && i === 0}
                    aria-label={`Digit ${i + 1} of ${length}`}
                    className={digit.trim() ? 'filled' : undefined}
                />
            ))}
        </div>
    );
}

/* ── Notice ────────────────────────────────────────────────────────────
   A hairline strip in the flow of the page, not a coloured card floating
   inside it. */
export function Notice({ icon, children, tone, className = '' }) {
    return (
        <div className={`notice ${tone === 'alert' ? 'notice-alert' : ''} ${className}`}>
            {icon}
            <div>{children}</div>
        </div>
    );
}

export function EmptyState({ glyph, title, children, action, className = '' }) {
    return (
        <div className={`empty ${className}`}>
            {glyph}
            <h2 className="t-h2">{title}</h2>
            {children && <div className="t-body dim mt-3">{children}</div>}
            {action && <div className="mt-6">{action}</div>}
        </div>
    );
}

export function Skeleton({ className = '', style }) {
    return <div className={`skel ${className}`} style={style} aria-hidden="true" />;
}

/* ── Sheet ─────────────────────────────────────────────────────────────
   One modal implementation for the confirm dialog and the track-price
   sheet: Escape closes, the backdrop closes, focus is trapped while open,
   the page behind cannot scroll, and focus returns to whatever opened it. */
export function Sheet({
    open,
    onClose,
    labelledBy,
    describedBy,
    children,
    className = '',
    side = false,
}) {
    const panelRef = useRef(null);
    const restoreRef = useRef(null);

    const focusables = useCallback(
        () =>
            Array.from(
                panelRef.current?.querySelectorAll(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                ) || []
            ),
        []
    );

    useEffect(() => {
        if (!open) return undefined;

        restoreRef.current = document.activeElement;
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';

        // Focus the first control, or the panel itself if there is none.
        const first = focusables()[0];
        (first || panelRef.current)?.focus();

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) return;
            const firstItem = items[0];
            const lastItem = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstItem) {
                e.preventDefault();
                lastItem.focus();
            } else if (!e.shiftKey && document.activeElement === lastItem) {
                e.preventDefault();
                firstItem.focus();
            }
        };

        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = overflow;
            const restore = restoreRef.current;
            if (restore && typeof restore.focus === 'function') restore.focus();
        };
    }, [open, onClose, focusables]);

    if (!open) return null;

    // `side` anchors the panel to the right edge at full height instead of
    // centring it. Everything above — Escape, the trap, the scroll lock,
    // the focus return — is shared.
    return (
        <div
            className={`fixed inset-0 z-[10000] flex animate-fadeIn ${
                side ? 'justify-end' : 'items-center justify-center p-4'
            }`}
        >
            <div className="scrim" onClick={onClose} aria-hidden="true" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                tabIndex={-1}
                className={
                    side
                        ? `sidepanel animate-slideIn ${className}`
                        : `sheet animate-popIn ${className}`
                }
            >
                {children}
            </div>
        </div>
    );
}
