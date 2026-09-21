import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Truck,
  ShieldCheck,
  Bell,
  Check,
  Zap,
  Sparkles,
  X,
} from 'lucide-react';
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
import SourcePill, { sellerLabel } from './SourcePill';
import { Stars, QuantitySelect, Spinner, Sheet } from './ui/Primitives';
import { ratingFor, reviewsFor, formatPrice } from '../productMeta';

function ProductDetails() {
  const { source, productId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [cartCount, setCartCount] = useState(0);
  const [trackOpen, setTrackOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Both AI surfaces hide themselves when the service has no API key. The
  // page listens for that so it never offers a way into an empty panel.
  const [advisorOut, setAdvisorOut] = useState(false);
  const [qaOut, setQaOut] = useState(false);
  const navigate = useNavigate();

  const onAdvisorOut = useCallback(() => setAdvisorOut(true), []);
  const onQaOut = useCallback(() => setQaOut(true), []);
  const aiAvailable = !(advisorOut && qaOut);

  useEffect(() => {
    if (!aiAvailable) setAiOpen(false);
  }, [aiAvailable]);

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
        <div className="shell-wide py-24 flex-1 flex flex-col items-center justify-center gap-4">
          <Spinner />
          <p className="t-ui dim">Loading product details...</p>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const rating = ratingFor(product._id || productId);
  const reviews = reviewsFor(product._id || productId);
  const inStock = !!product.inStock;
  const sourceLabel = sellerLabel(source);
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

      <div className="pagebar">
        <div className="pagebar-inner">
          <button type="button" onClick={() => navigate(-1)} className="btn btn-plain !px-0">
            <ChevronLeft size={15} aria-hidden="true" /> Back
          </button>
        </div>
      </div>

      <main className="flex-1">
        <div className="shell-wide py-8 md:py-12">
          <div className="grid gap-8 lg:gap-10 xl:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,44%)_minmax(0,1fr)_320px] items-start">
            {/* Image — on haze, so the product floats rather than sitting
                in a bordered box. */}
            <section className="lg:sticky lg:top-24">
              <div className="rounded-card bg-haze aspect-square grid place-items-center overflow-hidden">
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-[82%] h-[82%] object-contain"
                />
              </div>
            </section>

            {/* Identity and copy */}
            <section>
              <SourcePill provider={source} />

              <h1 className="t-d3 mt-4">{product.name}</h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 t-ui">
                <Stars rating={rating} size={15} />
                <span className="font-medium">{rating.toFixed(1)} out of 5</span>
                <span className="dim">{reviews.toLocaleString()} ratings</span>
                <span className={`status ${inStock ? 'status-ok' : 'status-bad'}`}>
                  {inStock ? 'In stock' : 'Out of stock'}
                </span>
              </div>

              {/* Facts — a hairline table, exactly the four the app has. */}
              <dl className="mt-8 border-t border-hairline">
                {productFacts.map((fact) => (
                  <div
                    key={fact.label}
                    className="grid grid-cols-[110px_1fr] gap-4 py-3 border-b border-hairlineSoft t-ui"
                  >
                    <dt className="dim">{fact.label}</dt>
                    <dd className="font-medium truncate">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              <section className="mt-9">
                <h2 className="t-h3">About this item</h2>
                <ul className="mt-3.5">
                  {aboutItems.map((feature, index) => (
                    <li
                      key={index}
                      className="grid grid-cols-[18px_1fr] gap-3 py-2 t-body dim leading-relaxed"
                    >
                      <Check size={15} className="mt-1.5 shrink-0 text-ink3" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mt-9">
                <h2 className="t-h3">Product description</h2>
                <p className="t-body dim measure mt-3 leading-relaxed">{product.description}</p>
              </section>
            </section>

            {/* Buy rail */}
            <aside className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-24">
              <div className="rail">
                <p className="rail-price">{formatPrice(product.price)}</p>

                <p className="flex items-center gap-2 t-ui mt-3" style={{ color: 'var(--green)' }}>
                  <Truck size={16} aria-hidden="true" /> Free shipping
                </p>

                <p className="t-ui dim mt-2.5">
                  Sold by <span className="font-medium text-ink">{product.soldBy || sourceLabel}</span>
                </p>

                <p className={`status ${inStock ? 'status-ok' : 'status-bad'} status-lg mt-4`}>
                  {inStock ? 'In stock' : 'Out of stock'}
                </p>

                <hr className="rule my-6 !bg-hairlineSoft" />

                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="quantity" className="t-ui font-medium">
                    Quantity
                  </label>
                  <QuantitySelect
                    id="quantity"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </div>

                <div className="mt-5 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!inStock}
                    className="btn btn-quiet btn-lg btn-full"
                  >
                    Add to cart
                  </button>
                  <button
                    type="button"
                    onClick={handleBuyNow}
                    disabled={!inStock}
                    className="btn btn-blue btn-lg btn-full"
                  >
                    <Zap size={16} aria-hidden="true" /> Buy now on {sourceLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) {
                        handleError('Sign in to track this price.');
                        navigate('/login');
                        return;
                      }
                      setTrackOpen(true);
                    }}
                    className="btn btn-plain btn-full !h-9"
                    title="Get an email when this drops"
                  >
                    <Bell size={15} aria-hidden="true" /> Track price
                  </button>
                </div>

                {/* The way in to the advisor and the grounded Q&A, sitting
                    where the buy decision is actually made. */}
                {aiAvailable && (
                  <>
                    <hr className="rule my-6 !bg-hairlineSoft" />
                    <button
                      type="button"
                      onClick={() => setAiOpen(true)}
                      className="btn btn-quiet btn-full"
                      aria-haspopup="dialog"
                      aria-expanded={aiOpen}
                    >
                      <span className="ai-glyph !w-[19px] !h-[19px] !rounded-[6px]">
                        <Sparkles size={11} aria-hidden="true" />
                      </span>
                      Buy now or wait?
                    </button>
                    <p className="text-cap dimmer text-center mt-2.5 leading-relaxed">
                      Price advice and questions about this listing
                    </p>
                  </>
                )}

                <hr className="rule my-6 !bg-hairlineSoft" />

                {/* Each fact names who is actually responsible, rather than
                    reading as a promise from Trendy Treasures. */}
                <div className="flex flex-col gap-3">
                  <p className="rail-fact">
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span>Secure checkout, handled by {sourceLabel}.</span>
                  </p>
                  <p className="rail-fact">
                    <Truck size={15} aria-hidden="true" />
                    <span>Tracked delivery, fulfilled by {sourceLabel}.</span>
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* Recorded prices get the full width of the page. A chart earns
            the room; the generated panels live in the side panel. */}
        <div className="band border-t border-hairline">
          <div className="shell-wide py-10 md:py-14">
            <PriceHistoryChart
              provider={source}
              productId={product._id || productId}
              currentPrice={product.price}
            />
          </div>
        </div>
      </main>

      {/* Product intelligence, as a right-side slide-over. Escape, the
          backdrop, the focus trap and the scroll lock come from <Sheet>,
          the same one the confirm and track-price dialogs use. The
          luminous rule lives on the panel, so it marks the whole
          generated surface once. */}
      <Sheet
        side
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        labelledBy="ai-panel-title"
      >
        <header className="sidepanel-head">
          <span className="ai-glyph">
            <Sparkles size={15} aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="ai-panel-title" className="t-h4">Product intelligence</h2>
            <p className="text-cap dimmer truncate">{product.name}</p>
          </div>
          <button
            type="button"
            onClick={() => setAiOpen(false)}
            className="icon-btn"
            aria-label="Close product intelligence"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="sidepanel-body flex flex-col gap-7">
          <PriceAdvisorWidget
            bare
            onUnavailable={onAdvisorOut}
            provider={source}
            productId={product._id || productId}
          />

          {/* Only a divider when there is something above it to divide. */}
          {!advisorOut && <hr className="rule !bg-hairlineSoft" />}

          <ProductQAChat
            bare
            onUnavailable={onQaOut}
            provider={source}
            productId={product._id || productId}
            productName={product.name}
            productDescription={product.description}
            productFeatures={product.features}
            productPrice={product.price}
          />
        </div>
      </Sheet>

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
