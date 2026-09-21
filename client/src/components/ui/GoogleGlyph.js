import React from 'react';

/**
 * Google's four-colour G, for the "Continue with Google" button.
 *
 * lucide-react is a monochrome stroke set and has no brand glyphs, and a
 * single-colour silhouette is not what Google's brand guidance asks for on a
 * light button. Drawn inline so it needs no network request.
 */
function GoogleGlyph({ size = 17 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path
                fill="#4285F4"
                d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2.1 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
            />
            <path
                fill="#34A853"
                d="M24 46c6 0 11-2 14.6-5.2l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.2v5.7C7.8 41.2 15.3 46 24 46z"
            />
            <path
                fill="#FBBC05"
                d="M11.6 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.2A22 22 0 0 0 2 24c0 3.6.9 6.9 2.2 9.9l7.4-5.6z"
            />
            <path
                fill="#EA4335"
                d="M24 10.6c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.3 2 7.8 6.8 4.2 13.7l7.4 5.7c1.7-5.2 6.6-8.8 12.4-8.8z"
            />
        </svg>
    );
}

export default GoogleGlyph;
