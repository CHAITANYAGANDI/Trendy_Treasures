import React from 'react';

/**
 * Seller identity.
 *
 * Amazon orange and Walmart blue are capped at a 14px glyph sitting beside
 * the seller's name inside a neutral hairline container: loud enough to read
 * at a glance on every tile, product page, cart line and alert row, too small
 * to colour the composition or to compete with Trendy Treasures' own brand.
 *
 * Both marks are drawn inline rather than loaded from the provider's CDN.
 * Walmart's published SVG is the *full* lockup — a wordmark next to the spark
 * — so pairing it with a "Walmart" label printed the name twice; Amazon's is
 * a remote file that a broken CDN or an offline demo would leave as a gap in
 * the layout. Inline glyphs inherit `currentColor`, so the same mark works on
 * white, on haze and reversed out of a filled seller-coloured button.
 *
 * The props `provider`, `prefix` and `className` are unchanged from the
 * previous version of this component, so every existing call site keeps
 * working exactly as before.
 */

const SPARK_ANGLES = [0, 60, 120, 180, 240, 300];

function AmazonGlyph() {
    return (
        <svg
            className="seller-glyph"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
        >
            {/* The smile: an arc under the wordmark, plus its upward flick. */}
            <path
                d="M1.8 16.1c3.5 2.4 7.7 3.6 12 3.6 2.9 0 5.7-.6 8.4-1.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
            />
            <path
                d="M19.2 14.1c1.4-.6 3.1-.9 3.9-.3.7.5.3 2.2-.5 3.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function WalmartGlyph() {
    return (
        <svg
            className="seller-glyph"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
        >
            {SPARK_ANGLES.map((deg) => (
                <rect
                    key={deg}
                    x="10.8"
                    y="1.8"
                    width="2.4"
                    height="7.6"
                    rx="1.2"
                    fill="currentColor"
                    transform={`rotate(${deg} 12 12)`}
                />
            ))}
        </svg>
    );
}

export const normalizeSeller = (provider) =>
    String(provider || '').trim().toLowerCase() === 'walmart' ? 'walmart' : 'amazon';

export const sellerLabel = (provider) =>
    normalizeSeller(provider) === 'walmart' ? 'Walmart' : 'Amazon';

/**
 * @param provider  'amazon' | 'walmart'
 * @param prefix    rendered ahead of the name, e.g. "Sold on"
 * @param boxed     wrap in the hairline pill (default true)
 * @param size      'xs' | 'md' | 'lg'
 * @param onDark    reverse the glyph and name out of a coloured surface
 * @param glyphOnly drop the text, for very tight rows
 */
function SourcePill({
    provider,
    prefix,
    className = '',
    boxed = true,
    size = 'md',
    onDark = false,
    glyphOnly = false,
}) {
    const seller = normalizeSeller(provider);
    const label = sellerLabel(seller);

    const classes = [
        'seller',
        `seller-${seller}`,
        boxed ? 'seller-boxed' : '',
        size === 'xs' ? 'seller-xs' : '',
        size === 'lg' ? 'seller-lg' : '',
        onDark ? 'seller-on-dark' : '',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes}>
            {seller === 'amazon' ? <AmazonGlyph /> : <WalmartGlyph />}
            {glyphOnly ? (
                <span className="sr-only">{label}</span>
            ) : (
                <span>{prefix ? `${prefix} ${label}` : label}</span>
            )}
        </span>
    );
}

export default SourcePill;
