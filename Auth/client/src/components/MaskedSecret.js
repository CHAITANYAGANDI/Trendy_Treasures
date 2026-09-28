import React, { useState } from 'react';

// A fixed-length mask rather than one dot per character, so the hidden
// state doesn't reveal how long the secret is.
const MASK = '•'.repeat(32);

// Renders a secret as password dots until the user asks to see it, so it
// isn't exposed on screen (or in a screenshot / screen share) just because
// the dialog is open. Copy buttons elsewhere still copy the real value.
function MaskedSecret({ value, label = 'secret', style }) {
    const [revealed, setRevealed] = useState(false);

    return (
        <div className="relative px-10 py-3 rounded font-mono text-xs break-all" style={style}>
            <span className={revealed ? '' : 'tracking-widest select-none'}>
                {revealed ? value : MASK}
            </span>
            <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
                aria-pressed={revealed}
                className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer bg-transparent border-0 opacity-70 hover:opacity-100 transition-opacity"
                style={{ color: 'inherit' }}
            >
                <span className="material-symbols-outlined text-lg">
                    {revealed ? 'visibility' : 'visibility_off'}
                </span>
            </button>
        </div>
    );
}

export default MaskedSecret;
