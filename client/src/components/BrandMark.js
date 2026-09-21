import React, { useId } from 'react';

/**
 * Trendy Treasures app mark.
 *
 * Two overlapping "T" forms on a rounded tile: a charcoal one behind and a
 * steel-blue one offset down and to the right, separated by a knockout in
 * the tile colour so the two stay legible where they cross. Sized by the
 * caller through `className` (e.g. `w-6 h-6`).
 *
 * The gradient ids are generated per instance — several marks render on the
 * same page (header, footer, auth), and duplicate ids would make every one
 * of them resolve to whichever definition appeared first.
 */
function BrandMark({ className = '' }) {
    const uid = useId().replace(/:/g, '');
    const tile = `tt-tile-${uid}`;
    const dark = `tt-dark-${uid}`;
    const blue = `tt-blue-${uid}`;

    return (
        <svg
            className={className}
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id={tile} x1="0" y1="0" x2="0.35" y2="1">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="1" stopColor="#e6ecf2" />
                </linearGradient>
                <linearGradient id={dark} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#414b57" />
                    <stop offset="1" stopColor="#1e252e" />
                </linearGradient>
                <linearGradient id={blue} x1="0.1" y1="0" x2="0.9" y2="1">
                    <stop offset="0" stopColor="#cbdcef" />
                    <stop offset="0.45" stopColor="#8fb4dc" />
                    <stop offset="1" stopColor="#5d93c9" />
                </linearGradient>
            </defs>

            {/* Tile */}
            <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="11.5" fill={`url(#${tile})`} />
            <rect
                x="0.75"
                y="0.75"
                width="46.5"
                height="46.5"
                rx="11.5"
                stroke="#000000"
                strokeOpacity="0.08"
                strokeWidth="1.5"
            />

            {/* Charcoal T, behind. Its stem stops short of the blue one so
                both feet stay readable. */}
            <g fill={`url(#${dark})`}>
                <rect x="5" y="5" width="18.5" height="10" rx="5" />
                <rect x="11.5" y="5" width="13.5" height="32.5" rx="6.75" />
            </g>

            {/* Knockout in the tile colour, so the blue reads as a separate
                form where it crosses the charcoal one. */}
            <g fill="#eef2f7">
                <rect x="15.5" y="8" width="29" height="16" rx="8" />
                <rect x="15.5" y="8" width="17" height="37" rx="8.5" />
            </g>

            {/* Steel-blue T, in front */}
            <g fill={`url(#${blue})`}>
                <rect x="17.5" y="10" width="25.5" height="12" rx="6" />
                <rect x="17.5" y="10" width="13" height="33" rx="6.5" />
            </g>
        </svg>
    );
}

/**
 * The wordmark: "Trendy" set bold against "Treasures" in book weight, so
 * the lockup carries emphasis without a second typeface. Inherits
 * currentColor, which is what lets it sit on the dark admin pages.
 */
export function Wordmark({ className = '' }) {
    return (
        <span className={`brand-word ${className}`}>
            <b>Trendy</b> Treasures
        </span>
    );
}

export default BrandMark;
