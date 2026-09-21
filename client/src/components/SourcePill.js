import React from 'react';

const AMAZON_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg';

const SPARK_ANGLES = [0, 60, 120, 180, 240, 300];

// Walmart's published logo SVG is the *full* lockup — a white "Walmart"
// wordmark next to the spark — so pairing it with a "Walmart" text label
// printed the name twice, and the white copy was nearly invisible against the
// pale blue pill. The spark is drawn inline instead: six rounded rays at 60°,
// which is all that survives at 12px anyway, and the name comes from the
// pill's own text where it inherits a readable colour.
function WalmartSpark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {SPARK_ANGLES.map((deg) => (
        <rect
          key={deg}
          x="10.8"
          y="1.6"
          width="2.4"
          height="8"
          rx="1.2"
          fill="#ffc220"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}

// Provider badge used on product cards, the product page and the cart.
// Amazon's wordmark reads cleanly on its own, so that pill is the mark alone
// and the `alt` carries the name for screen readers. Walmart's is spark +
// text. `prefix` renders ahead of the brand ("Sold on Amazon").
function SourcePill({ provider, prefix, className = '' }) {
  const isAmazon = provider === 'amazon';
  const label = isAmazon ? 'Amazon' : 'Walmart';
  const pill = isAmazon ? 'source-pill-amazon' : 'source-pill-walmart';

  return (
    <span className={`${pill} ${className}`.trim()}>
      {isAmazon ? (
        <>
          {prefix ? <span>{prefix}</span> : null}
          <img src={AMAZON_LOGO} alt={label} className="h-3 shrink-0" />
        </>
      ) : (
        <>
          <WalmartSpark />
          <span>{prefix ? `${prefix} ${label}` : label}</span>
        </>
      )}
    </span>
  );
}

export default SourcePill;
