import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShoppingBag, Trash2, Lock, Info, ArrowRight, ChevronLeft } from 'lucide-react';
import {
  handleError,
  handleSuccess,
  fetchCurrentUser,
  apiFetch,
  getGuestCart,
  updateGuestCartQuantity,
  removeFromGuestCart,
  createCheckoutIntent,
  redirectToProviderCheckout,
  logoutUser,
} from '../utils';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SourcePill, { sellerLabel } from './SourcePill';
import { QuantitySelect, EmptyState, Notice } from './ui/Primitives';
import { formatPrice } from '../productMeta';

const normalizeSource = (source) => {
  const value = String(source || '').trim().toLowerCase();
  return value === 'amazon' || value === 'walmart' ? value : null;
};

function Cart() {
  const [cartItems, setCartItems] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [subTotal, setSubTotal] = useState(0);
  const [updatedItems, setUpdatedItems] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then((user) => {
      if (cancelled) return;
      setCurrentUser(user);
      setAuthResolved(true);
      if (user) fetchCartDetails();
      else {
        const items = getGuestCart();
        setCartItems(items);
        calculateSubtotal(items);
      }
    });
    return () => { cancelled = true; };
    // fetchCartDetails is intentionally not in deps — this effect is the
    // one-time auth-resolve-and-load on mount, not a reactive sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    handleSuccess('Logged out successfully');
    setTimeout(() => navigate('/login'), 800);
  };

  const fetchCartDetails = async () => {
    try {
      const response = await apiFetch('/cart/get');
      if (response.ok) {
        const result = await response.json();
        setCartItems(result.cartItems || []);
        calculateSubtotal(result.cartItems || []);
      } else if (response.status === 404) {
        setCartItems([]);
        setSubTotal(0);
      } else {
        const errorData = await response.json();
        if (errorData.message && errorData.message.toLowerCase().includes('token has expired')) {
          handleLogout();
        }
        handleError(errorData.message || 'Failed to fetch cart items.');
      }
    } catch (err) {
      handleError(err.message || 'Error fetching cart details.');
    }
  };

  const calculateSubtotal = (items) => {
    const subtotal = items.reduce(
      (total, item) => total + Number(item.productPrice) * Number(item.productQuantity),
      0
    );
    setSubTotal(subtotal);
  };

  const handleQuantityChange = (productName, newQuantity) => {
    setUpdatedItems((prev) => ({ ...prev, [productName]: newQuantity }));
  };

  const handleUpdateQuantity = async (productName) => {
    const newQuantity = updatedItems[productName];
    if (!newQuantity) return;

    if (!currentUser) {
      const next = updateGuestCartQuantity(productName, newQuantity);
      setCartItems(next);
      calculateSubtotal(next);
      setUpdatedItems((prev) => {
        const { [productName]: _, ...rest } = prev;
        return rest;
      });
      handleSuccess('Quantity updated');
      return;
    }

    try {
      const response = await apiFetch('/cart/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, productQuantity: newQuantity }),
      });

      if (response.ok) {
        handleSuccess('Quantity updated successfully!');
        fetchCartDetails();
        setUpdatedItems((prev) => {
          const { [productName]: _, ...rest } = prev;
          return rest;
        });
      } else {
        const errorData = await response.json();
        handleError(errorData.message || 'Failed to update quantity.');
      }
    } catch (err) {
      handleError(err.message || 'Error updating quantity.');
    }
  };

  const handleRemoveItem = async (productName) => {
    if (!currentUser) {
      const next = removeFromGuestCart(productName);
      setCartItems(next);
      calculateSubtotal(next);
      handleSuccess('Item removed');
      return;
    }

    try {
      const response = await apiFetch('/cart/remove', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName }),
      });

      if (response.ok) {
        handleSuccess('Item removed successfully!');
        fetchCartDetails();
      } else {
        const errorData = await response.json();
        handleError(errorData.message || 'Failed to remove item.');
      }
    } catch (err) {
      handleError(err.message || 'Error removing item.');
    }
  };

  const handleSourceCheckout = async (source) => {
    if (!currentUser) {
      handleError('Sign in to complete your purchase.');
      navigate('/login');
      return;
    }
    const providerSource = normalizeSource(source);
    if (!providerSource) {
      handleError('Choose Amazon or Walmart checkout for these items.');
      return;
    }

    const sellerItems = cartItems.filter((item) => deriveSource(item) === providerSource);
    if (!sellerItems.length) {
      handleError('No items from this seller in your cart.');
      return;
    }
    try {
      const { referralCode } = await createCheckoutIntent({
        provider: providerSource,
        items: sellerItems.map((it) => ({
          source: providerSource,
          providerProductId: it.providerProductId || it._id || '',
          productName: it.productName,
          productPrice: Number(it.productPrice),
          productImageUrl: it.productImageUrl,
          quantity: Number(it.productQuantity),
        })),
      });
      redirectToProviderCheckout(providerSource, referralCode);
    } catch (err) {
      handleError(err.message || 'Could not start checkout.');
    }
  };

  const deriveSource = (item) => {
    const soldBy = String(item.productSoldBy || '').toLowerCase();
    if (soldBy.includes('walmart')) return 'walmart';
    if (soldBy.includes('amazon')) return 'amazon';
    const explicitSource = normalizeSource(item.source);
    if (explicitSource) return explicitSource;
    return 'amazon';
  };

  const itemsBySource = cartItems.reduce((acc, item) => {
    const src = deriveSource(item);
    if (!acc[src]) acc[src] = { items: [], subtotal: 0 };
    acc[src].items.push(item);
    acc[src].subtotal += Number(item.productPrice) * Number(item.productQuantity);
    return acc;
  }, {});

  const sourcesInCart = Object.keys(itemsBySource);
  const cartCount = cartItems.reduce((a, c) => a + Number(c.productQuantity || 0), 0);

  // One line, rendered inside its seller's group.
  const renderLine = (item) => {
    const editing =
      updatedItems[item.productName] !== undefined &&
      updatedItems[item.productName] !== item.productQuantity;

    return (
      <li
        key={item.productName}
        className="grid grid-cols-[84px_1fr] sm:grid-cols-[110px_1fr] gap-4 sm:gap-5 py-6 border-b border-hairlineSoft"
      >
        <div className="rounded-fld bg-haze aspect-square grid place-items-center overflow-hidden">
          <img
            src={item.productImageUrl}
            alt={item.productName}
            className="w-[82%] h-[82%] object-contain"
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="t-body font-medium clamp2">{item.productName}</h3>
            <p className="t-h4 tnum shrink-0">
              {formatPrice(Number(item.productPrice) * Number(item.productQuantity))}
            </p>
          </div>

          <p className="t-cap dim mt-1 tnum">
            {formatPrice(item.productPrice)} each
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <label htmlFor={`qty-${item.productName}`} className="t-cap dim">
              Qty
            </label>
            <QuantitySelect
              id={`qty-${item.productName}`}
              ariaLabel={`Quantity for ${item.productName}`}
              value={
                updatedItems[item.productName] !== undefined
                  ? updatedItems[item.productName]
                  : item.productQuantity
              }
              onChange={(e) =>
                handleQuantityChange(item.productName, parseInt(e.target.value))
              }
            />
            {/* Update only exists once the number has actually changed. */}
            {editing && (
              <button
                type="button"
                onClick={() => handleUpdateQuantity(item.productName)}
                className="btn btn-outline btn-sm"
              >
                Update
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRemoveItem(item.productName)}
              className="icon-btn icon-btn-danger ml-auto"
              aria-label={`Remove ${item.productName}`}
              title="Remove"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    );
  };

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
          <Link to="/home" className="btn btn-plain !px-0">
            <ChevronLeft size={15} aria-hidden="true" /> Continue shopping
          </Link>
        </div>
      </div>

      <main className="shell-wide py-8 md:py-12 flex-1 w-full">
        <header className="mb-8">
          <h1 className="t-d3">Your cart</h1>
          <p className="t-ui dim mt-1.5">
            {cartItems.length === 0
              ? 'No items yet — let\'s find something good.'
              : `${cartItems.length} item${cartItems.length === 1 ? '' : 's'} from ${sourcesInCart.length} seller${sourcesInCart.length === 1 ? '' : 's'}`}
          </p>
        </header>

        {!currentUser && authResolved && cartItems.length > 0 && (
          <Notice icon={<Info size={17} aria-hidden="true" />} className="mb-8">
            Items in this cart are stored in your browser.{' '}
            <Link to="/login" className="link font-medium">Sign in</Link> to save them
            and check out.
          </Notice>
        )}

        {cartItems.length === 0 ? (
          <EmptyState
            glyph={<ShoppingBag size={38} className="glyph" aria-hidden="true" />}
            title="Your cart is empty"
            action={
              <button type="button" onClick={() => navigate('/home')} className="btn btn-blue btn-lg">
                Start shopping <ArrowRight size={16} aria-hidden="true" />
              </button>
            }
          >
            Browse Amazon and Walmart side by side and pick out something you love.
          </EmptyState>
        ) : (
          <div className="grid gap-10 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
            {/* Lines, grouped by the seller who actually holds the item. */}
            <div>
              {sourcesInCart.map((src) => (
                <section key={src} className="mb-10 last:mb-0">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-hairline">
                    <SourcePill provider={src} prefix="Sold on" />
                    <p className="t-cap dim tnum">
                      {itemsBySource[src].items.length} item
                      {itemsBySource[src].items.length === 1 ? '' : 's'} ·{' '}
                      {formatPrice(itemsBySource[src].subtotal)}
                    </p>
                  </div>
                  <ul>{itemsBySource[src].items.map(renderLine)}</ul>
                </section>
              ))}
            </div>

            {/* Summary */}
            <aside className="lg:sticky lg:top-28">
              <h2 className="t-h3">Order summary</h2>

              <div className="mt-5 border-t border-hairline">
                {sourcesInCart.map((src) => {
                  const group = itemsBySource[src];
                  return (
                    <div
                      key={src}
                      className="flex justify-between gap-4 py-3 border-b border-hairlineSoft t-ui"
                    >
                      <span className="dim">
                        {sellerLabel(src)} · {group.items.length} item
                        {group.items.length === 1 ? '' : 's'}
                      </span>
                      <span className="font-medium tnum">{formatPrice(group.subtotal)}</span>
                    </div>
                  );
                })}

                <div className="flex justify-between items-baseline gap-4 pt-4">
                  <span className="t-ui font-medium">Subtotal</span>
                  <span className="t-h2 tnum">{formatPrice(subTotal)}</span>
                </div>
                <p className="t-cap dim mt-2 leading-relaxed">
                  Shipping and taxes are calculated by each seller at checkout.
                </p>
              </div>

              {sourcesInCart.length > 1 && (
                <Notice icon={<Info size={17} aria-hidden="true" />} className="mt-6">
                  Your items come from {sourcesInCart.length} different sellers. You'll
                  check out with each one separately.
                </Notice>
              )}

              <div className="mt-6 flex flex-col gap-2.5">
                {!currentUser ? (
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="btn btn-blue btn-lg btn-full"
                  >
                    <Lock size={15} aria-hidden="true" /> Sign in to check out
                  </button>
                ) : (
                  sourcesInCart.map((src) => {
                    const group = itemsBySource[src];
                    return (
                      <div
                        key={src}
                        className="border border-hairline rounded-tile p-4 flex flex-col gap-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <SourcePill provider={src} size="xs" />
                          <span className="t-ui font-medium tnum">
                            {formatPrice(group.subtotal)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSourceCheckout(src)}
                          className="btn btn-blue btn-full"
                        >
                          Continue on {sellerLabel(src)}
                          <ArrowRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <p className="rail-fact mt-6">
                <Lock size={15} aria-hidden="true" />
                <span>
                  Trendy Treasures never sees your payment details. Each seller
                  processes your card on their own secure checkout.
                </span>
              </p>
            </aside>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

export default Cart;
