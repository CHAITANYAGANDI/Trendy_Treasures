import React from 'react';
import { scorePassword } from '../utils';

const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

// Four bars driven by scorePassword(), 0–4. The colour is carried by the
// bars; the sentence beneath stays in reading ink so it is legible at every
// score instead of turning red at the weakest one.
function PasswordStrengthHint({ password }) {
    const score = scorePassword(password);

    return (
        <div className="mt-2.5">
            <div className="strength" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                    <i key={i} className={i <= score ? `on-${score}` : undefined} />
                ))}
            </div>
            <p className="field-hint">
                {password
                    ? `${STRENGTH_LABELS[score]} — use 8+ characters with uppercase, lowercase, and a digit.`
                    : 'Use 8+ characters with uppercase, lowercase, and a digit.'}
            </p>
        </div>
    );
}

export default PasswordStrengthHint;
