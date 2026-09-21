import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FaStar, FaShippingFast, FaShieldAlt, FaArrowLeft, FaCheckCircle, FaTimesCircle, FaBolt, FaBell } from 'react-icons/fa';
import {
  handleError,
  handleSuccess,
  fetchCurrentUser,
  apiFetch,
  amazonFetch,
  walmartFetch,
  addToGuestCart,
  createCheckoutIntent,
  redirectToProviderCheckout,
  getGuestCart,
} from '../utils';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import PriceHistoryChart from './PriceHistoryChart';
import TrackPriceModal from './TrackPriceModal';
import PriceAdvisorWidget from './PriceAdvisorWidget';
import ProductQAChat from './ProductQAChat';
import SourcePill from './SourcePill';
import '../ProductDetails.css';

const ratingFor = (id) => {
  if (!id) return 4.4;
  const sum = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return Math.round((3.8 + (sum % 13) / 10) * 10) / 10;
};

const reviewsFor = (id) => {
  if (!id) return 124;
  const sum = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return 50 + (sum % 950);
};

function ProductDetails() {
  const { source, productId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [cartCount, setCartCount] = useState(0);
  const [trackOpen, setTrackOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setCurrentUser(u);
      if (u && u.email) refreshCartCount();
      else setCartCount(getGuestCart().reduce((a, c) => a + Number(c.productQuantity || 0), 0));
    });
  }, []);

  const refreshCartCount = async () => {
    try {
      const res = await apiFetch('/cart/get');
      if (res.ok) {
        const data = await res.json();
        setCartCount(
          (data.cartItems || []).reduce((a, c) => a + Number(c.productQuantity || 0), 0)
        );
      }
    } catch {}
  };

  useEffect(() => {
    const run = async () => {
      try {
        let response;
        if (source === 'walmart') response = await walmartFetch(`/${productId}`);
        else if (source === 'amazon') response = await amazonFetch(`/${productId}`);
        else throw new Error('Invalid source provided.');

        if (response.ok) {
          const result = await response.json();
          setProduct(result.product || result);
        } else {
          handleError('Failed to fetch product details.');
        }
      } catch (err) {
        handleError(err.message || 'Error fetching product details.');
      }
    };
    run();
  }, [source, productId]);

  const handleAddToCart = async () => {
    if (!product) return;
    const cartItem = {
      productName: product.name,
      productDescription: product.description,
      productImageUrl: product.imageUrl,
      productPrice: product.price,
      productQuantity: quantity,
      productSoldBy: product.soldBy,
      source,
      providerProductId: productId,
    };

    if (!currentUser) {
      addToGuestCart(cartItem);
      setCartCount((c) => c + quantity);
      handleSuccess('Added to cart. Sign in to check out.');
      return;
    }

    try {
      const response = await apiFetch('/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cartItem),
      });

      if (response.ok) {
        const data = await response.json();
        handleSuccess(data.message);
        refreshCartCount();
      } else {
        const errorData = await response.json();
        handleError(errorData.message || 'Failed to add product to cart.');
      }
    } catch (err) {
      handleError(err.message || 'Error adding product to cart.');
    }
  };

  const handleBuyNow = async () => {
    if (!product) return;
    if (!currentUser) {
      addToGuestCart({
        productName: product.name,
        productDescription: product.description,
        productImageUrl: product.imageUrl,
        productPrice: product.price,
        productQuantity: quantity,
        productSoldBy: product.soldBy,
        source,
        providerProductId: productId,
      });
      handleError('Sign in to complete your purchase.');
      navigate('/login');
      return;
    }

    try {
      const { referralCode } = await createCheckoutIntent({
        provider: source,
        items: [{
          providerProductId: productId,
          source,
          productName: product.name,
          productPrice: product.price,
          productImageUrl: product.imageUrl,
          quantity,
        }],
      });
      redirectToProviderCheckout(source, referralCode);
    } catch (err) {
      handleError(err.message || 'Could not start checkout.');
    }
  };

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <SiteHeader currentUser={currentUser} setCurrentUser={setCurrentUser} cartCount={cartCount} showSearch={false} />
        <div className="store-shell py-20 flex-1">
          <div className="card p-12 max-w-xl mx-auto text-center animate-pulse">
            <p className="text-ink-500">Loading product details...</p>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const rating = ratingFor(product._id || productId);
  const reviews = reviewsFor(product._id || productId);
  const inStock = !!product.inStock;
  const sourceLabel = source === 'amazon' ? 'Amazon' : 'Walmart';
  const filledStars = Math.max(1, Math.min(5, Math.round(rating)));
  const aboutItems = (
    Array.isArray(product.features) && product.features.length > 0
      ? product.features
      : [
          product.brand ? `Brand: ${product.brand}` : null,
          product.category ? `Category: ${product.category}` : null,
          product.description,
          inStock ? 'Available for checkout today.' : 'This item is currently out of stock.',
        ]
  ).filter(Boolean);
  const productFacts = [
    { label: 'Brand', value: product.brand || 'Generic' },
    { label: 'Category', value: product.category || 'General' },
    { label: 'Sold by', value: product.soldBy || sourceLabel },
    { label: 'Condition', value: 'New' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        cartCount={cartCount}
        showSearch={false}
      />

      <main className="store-shell py-6 lg:py-8 flex-1">
        <button
          onClick={() => navigate(-1)}
          className="btn-ghost mb-6"
        >
          <FaArrowLeft className="text-xs" /> Back
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,45%)_minmax(360px,1fr)] xl:grid-cols-[minmax(420px,42%)_minmax(360px,1fr)_minmax(280px,340px)] gap-6 xl:gap-8 items-start animate-fade-in">
          <section className="lg:sticky lg:top-24">
            <div className="bg-white border border-ink-100/70 rounded-2xl shadow-card overflow-hidden">
              <div className="relative min-h-[360px] sm:min-h-[480px] lg:min-h-[620px] xl:min-h-[680px] bg-gradient-to-br from-white via-ink-50 to-ink-100 flex items-center justify-center">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full max-h-[680px] object-contain p-8 sm:p-10"
                />
                <SourcePill
                  provider={source}
                  prefix="Sold on"
                  className="absolute top-4 left-4"
                />
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="border-b border-ink-200/70 pb-5">
              <SourcePill provider={source} />

              <h1 className="mt-4 text-2xl sm:text-3xl xl:text-4xl font-semibold text-ink-900 tracking-tight leading-tight">
                {product.name}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <FaStar
                      key={index}
                      className={index < filledStars ? 'text-yellow-400' : 'text-ink-200'}
                    />
                  ))}
                </div>
                <span className="font-semibold text-ink-800">{rating} out of 5</span>
                <span className="text-brand-700 font-medium">
                  {reviews.toLocaleString()} ratings
                </span>
                {inStock ? (
                  <span className="chip-success">
                    <FaCheckCircle /> In stock
                  </span>
                ) : (
                  <span className="chip-danger">
                    <FaTimesCircle /> Out of stock
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {productFacts.map((fact) => (
                <div key={fact.label} className="rounded-xl bg-white/80 border border-ink-100 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                    {fact.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink-900 truncate">
                    {fact.value}
                  </p>
                </div>
              ))}
            </div>

            <section className="border-b border-ink-200/70 pb-6">
              <h2 className="text-xl font-bold text-ink-900 mb-3">About this item</h2>
              <ul className="list-disc pl-5 space-y-2 text-sm sm:text-base text-ink-700 leading-relaxed">
                {aboutItems.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-ink-900 mb-3">Product description</h2>
              <p className="text-ink-700 leading-relaxed">
                {product.description}
              </p>
            </section>

            <PriceHistoryChart
              provider={source}
              productId={product._id || productId}
              currentPrice={product.price}
            />

            <PriceAdvisorWidget
              provider={source}
              productId={product._id || productId}
            />

            <ProductQAChat
              provider={source}
              productId={product._id || productId}
              productName={product.name}
              productDescription={product.description}
              productFeatures={product.features}
              productPrice={product.price}
            />
          </section>

          <aside className="lg:col-start-2 xl:col-start-auto xl:sticky xl:top-24">
            <div className="card !rounded-2xl p-5 xl:p-6">
              <p className="text-sm text-ink-500">Price</p>
              <p className="mt-1 text-4xl font-bold text-ink-900 leading-none">
                ${Number(product.price).toFixed(2)}
              </p>
              <p className="mt-3 text-sm text-emerald-700 font-semibold flex items-center gap-2">
                <FaShippingFast /> Free shipping
              </p>
              <p className="mt-3 text-sm text-ink-600">
                Sold by <span className="font-semibold text-ink-900">{product.soldBy || sourceLabel}</span>
              </p>

              <div className="mt-5">
                {inStock ? (
                  <p className="text-lg font-semibold text-emerald-700">In stock</p>
                ) : (
                  <p className="text-lg font-semibold text-red-700">Out of stock</p>
                )}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <label htmlFor="quantity" className="text-sm font-medium text-ink-700">
                  Quantity
                </label>
                <select
                  id="quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="px-4 py-2 rounded-full bg-white border border-ink-200/80 text-sm font-semibold text-ink-800 focus:outline-none focus:border-brand-400 focus:shadow-focus cursor-pointer"
                >
                  {[...Array(10).keys()].map((num) => (
                    <option key={num + 1} value={num + 1}>
                      {num + 1}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 flex flex-col gap-3">
                <button
                  onClick={handleAddToCart}
                  disabled={!inStock}
                  className="btn-secondary !py-3.5 w-full text-base"
                >
                  Add to cart
                </button>
                <button
                  onClick={handleBuyNow}
                  disabled={!inStock}
                  className="btn-primary !py-3.5 w-full text-base"
                >
                  <FaBolt /> Buy now on {sourceLabel}
                </button>
                <button
                  onClick={() => {
                    if (!currentUser) {
                      handleError('Sign in to track this price.');
                      navigate('/login');
                      return;
                    }
                    setTrackOpen(true);
                  }}
                  className="btn-ghost !py-3 w-full text-sm justify-center"
                  title="Get an email when this drops"
                >
                  <FaBell /> Track price
                </button>
              </div>

              <div className="mt-5 pt-5 border-t border-ink-100 space-y-3 text-xs text-ink-600">
                <div className="flex items-center gap-2">
                  <FaShieldAlt className="text-brand-500" />
                  <span>Secure checkout</span>
                </div>
                <div className="flex items-center gap-2">
                  <FaShippingFast className="text-brand-500" />
                  <span>Tracked delivery</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <TrackPriceModal
        open={trackOpen}
        onClose={() => setTrackOpen(false)}
        provider={source}
        productId={product._id || productId}
        productName={product.name}
        currentPrice={product.price}
      />

      <SiteFooter />
    </div>
  );
}

export default ProductDetails;
