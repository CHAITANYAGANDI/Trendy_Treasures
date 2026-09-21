// Deterministic pseudo-rating per product so the storefront feels alive
// without faking server-side data. The same product id always renders the
// same star count, so the value is stable on re-render.
//
// These two functions used to exist character-for-character in both Home.js
// and ProductDetails.js. They live here now so a tile and the product page it
// opens can never disagree about a product's rating.

export const ratingFor = (id) => {
  if (!id) return 4.4;
  const sum = String(id)
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return Math.round((3.8 + (sum % 13) / 10) * 10) / 10;
};

export const reviewsFor = (id) => {
  if (!id) return 124;
  const sum = String(id)
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return 50 + (sum % 950);
};

export const formatPrice = (value) => `$${Number(value || 0).toFixed(2)}`;
