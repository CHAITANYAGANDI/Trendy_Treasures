/** @type {import('tailwindcss').Config} */

/**
 * Design tokens for the Apple-inspired redesign.
 *
 * Every value here is duplicated as a CSS custom property in index.css so
 * that plain-CSS component classes and Tailwind utilities can be mixed in the
 * same element without the two drifting apart. Tailwind owns one-off layout;
 * index.css owns anything repeated more than twice.
 *
 * Everything lives under `extend` so Tailwind's own spacing, flex and grid
 * scales stay available.
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      fontFamily: {
        // System stack only — SF Pro resolves natively on Apple hardware,
        // Segoe UI on Windows. No webfont is downloaded and no Apple font
        // file is committed.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Inter',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },

      colors: {
        // Surface — Apple alternates pure white and #f5f5f7 band by band.
        // There is no third background; depth comes from the band change.
        paper: '#ffffff',
        haze: '#f5f5f7',
        hazeDeep: '#e8e8ed',
        hairline: '#d2d2d7',
        hairlineSoft: '#e8e8ed',

        // Ink — #1d1d1f is Apple's text colour, with two secondary greys.
        ink: '#1d1d1f',
        ink2: '#6e6e73',
        ink3: '#86868b',
        ink4: '#aeaeb2',

        // Action — exactly one accent. #0071e3 is the button blue, #0066cc
        // the link blue (darker, because links sit on white at small sizes).
        blue: '#0071e3',
        blueHover: '#0077ed',
        bluePress: '#006edb',
        blueWash: '#e8f2fd',
        link: '#0066cc',

        // Semantic — used on state, never on decoration.
        green: '#008009',
        greenWash: '#e3f5e6',
        amber: '#bf4800',
        amberWash: '#fdf0e7',
        red: '#e30000',
        redWash: '#fdecec',

        // Dark appearance, used by the admin sign-in page only.
        night: '#000000',
        nightRaise: '#1c1c1e',
        nightDeep: '#2c2c2e',
        nightLine: '#38383a',
        nightInk: '#f5f5f7',
        nightInk2: '#a1a1a6',
        nightInk3: '#8e8e93',
        nightInk4: '#636366',
        nightBlue: '#0a84ff',
        nightLink: '#2997ff',

        // Seller identity. Capped at a 14px glyph — loud enough to read on
        // every tile, too small to colour the composition. Amazon's own
        // #ff9900 fails contrast as a glyph on white, so a darkened tone is
        // used for the mark and the true brand colour kept for reference.
        amazon: '#e08300',
        amazonBrand: '#ff9900',
        walmart: '#0071dc',
        walmartBrand: '#0071dc',
        walmartSpark: '#ffc220',
      },

      // The type scale, 72px down to 12px. Responsive steps live on the
      // .t-* roles in index.css; these are the raw sizes.
      fontSize: {
        cap: ['12px', { lineHeight: '1.33', letterSpacing: '0.004em' }],
        ui: ['14px', { lineHeight: '1.43', letterSpacing: '0em' }],
        body: ['17px', { lineHeight: '1.47', letterSpacing: '-0.004em' }],
        lead: ['19px', { lineHeight: '1.42', letterSpacing: '-0.006em' }],
        h4: ['21px', { lineHeight: '1.24', letterSpacing: '-0.010em' }],
        h3: ['24px', { lineHeight: '1.20', letterSpacing: '-0.014em' }],
        h2: ['28px', { lineHeight: '1.15', letterSpacing: '-0.016em' }],
        h1: ['32px', { lineHeight: '1.13', letterSpacing: '-0.018em' }],
        d3: ['40px', { lineHeight: '1.10', letterSpacing: '-0.020em' }],
        d2: ['56px', { lineHeight: '1.07', letterSpacing: '-0.022em' }],
        d1: ['72px', { lineHeight: '1.05', letterSpacing: '-0.026em' }],
      },

      // Not one radius on everything: controls, fields, tiles and editorial
      // art each get their own. 980px is Apple's literal pill value.
      borderRadius: {
        hair: '6px',
        ctl: '8px',
        fld: '12px',
        tile: '18px',
        card: '28px',
        pill: '980px',
      },

      // Apple uses almost no shadow. Two exist — the editorial lift and the
      // modal. Everything else separates with a hairline or a band change.
      boxShadow: {
        lift: '0 4px 24px rgba(0,0,0,.06)',
        liftHover: '0 12px 40px rgba(0,0,0,.10)',
        modal: '0 24px 68px rgba(0,0,0,.22)',
        ring: '0 0 0 4px rgba(0,113,227,.28)',
        seg: '0 1px 3px rgba(0,0,0,.09), 0 1px 1px rgba(0,0,0,.04)',
      },

      maxWidth: {
        copy: '692px',
        page: '980px',
        wide: '1440px',
      },

      transitionTimingFunction: {
        apple: 'cubic-bezier(.25,.1,.25,1)',
        appleOut: 'cubic-bezier(.16,1,.3,1)',
      },

      // Only the animations driven by an `animate-*` utility belong here.
      // Anything referenced from plain CSS in index.css declares its own
      // @keyframes there, because Tailwind will not emit a block for a
      // utility it never sees used.
      keyframes: {
        popIn: {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Toasts sit at the top, so they arrive from above and leave the
        // same way rather than rising out of the middle of the page.
        toastIn: {
          '0%': { opacity: '0', transform: 'translateY(-12px) scale(.94)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        toastOut: {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-10px) scale(.96)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },

      animation: {
        popIn: 'popIn 250ms cubic-bezier(.16,1,.3,1) both',
        toastIn: 'toastIn 220ms cubic-bezier(.16,1,.3,1) both',
        toastOut: 'toastOut 260ms cubic-bezier(.4,0,1,1) both',
        fadeIn: 'fadeIn 320ms cubic-bezier(.25,.1,.25,1) both',
        slideIn: 'slideIn 320ms cubic-bezier(.16,1,.3,1) both',
      },
    },
  },
  plugins: [],
};
