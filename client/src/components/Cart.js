import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaShoppingBag, FaArrowRight, FaTrashAlt, FaLock, FaInfoCircle } from 'react-icons/fa';
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
import SourcePill from './SourcePill';
import '../Cart.css';

const normalizeSource = (source) => {
  const value = String(source || '').trim().toLowerCase();
  return value === 'amazon' || value === 'walmart' ? value : null;
};

const sellerLabel = (source) => (source === 'amazon' ? 'Amazon' : 'Walmart');

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

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader
        currentUser={currentUser}
        setCurrentUser={setCurrentUser}
        cartCount={cartCount}
        showSearch={false}
      />

      <main className="page-shell py-10 flex-1">
        <div className="flex items-end justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-ink-900 tracking-tight">
              Your cart
            </h1>
            <p className="text-ink-500 mt-1 text-sm">
              {cartItems.length === 0
                ? 'No items yet — let\'s find something good.'
                : `${cartItems.length} item${cartItems.length === 1 ? '' : 's'} from ${sourcesInCart.length} seller${sourcesInCart.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <Link to="/home" className="btn-ghost hidden sm:inline-flex">
            ← Continue shopping
          </Link>
        </div>

        {!currentUser && authResolved && cartItems.length > 0 && (
          <div className="glass rounded-2xl p-4 mb-6 flex items-start gap-3 text-sm text-ink-700 animate-fade-in">
            <FaInfoCircle className="text-brand-500 mt-0.5 shrink-0" />
            <p>
              Items in this cart are stored in your browser.{' '}
              <Link to="/login" className="text-brand-700 font-semibold hover:underline">
                Sign in
              </Link>{' '}
              to save them and check out.
            </p>
          </div>
        )}

        {cartItems.length === 0 ? (
          <div className="card p-12 text-center animate-fade-in max-w-xl mx-auto">
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-100 text-brand-600 flex items-center justify-center">
              <FaShoppingBag className="text-2xl" />
            </div>
            <h3 className="mt-5 text-xl font-bold text-ink-900">Your cart is empty</h3>
            <p className="text-ink-500 mt-2">
              Browse our curated collection and pick out something you love.
            </p>
            <button onClick={() => navigate('/home')} className="btn-primary mt-6">
              Start shopping <FaArrowRight />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
            {/* Line items */}
            <div className="lg:col-span-8 space-y-4">
              {cartItems.map((item, index) => {
                const src = deriveSource(item);
                const editing = updatedItems[item.productName] !== undefined
                  && updatedItems[item.productName] !== item.productQuantity;
                return (
                  <div
                    key={index}
                    className="card p-4 sm:p-5 flex flex-col sm:flex-row gap-4"
                  >
                    <div className="w-full sm:w-32 sm:h-32 h-40 shrink-0 rounded-2xl overflow-hidden bg-ink-50 flex items-center justify-center">
                      <img
                        src={item.productImageUrl}
                        alt={item.productName}
                        className="w-full h-full object-contain p-2"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-ink-900 line-clamp-2">
                          {item.productName}
                        </h3>
                        <button
                          onClick={() => handleRemoveItem(item.productName)}
                          className="p-2 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors shrink-0"
                          aria-label="Remove item"
                        >
                          <FaTrashAlt className="text-sm" />
                        </button>
                      </div>

                      <SourcePill provider={src} prefix="Sold on" className="mt-2" />

                      <div className="mt-3 flex flex-wrap items-center gap-3 justify-between">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-ink-500">Qty</label>
                          <select
                            value={
                              updatedItems[item.productName] !== undefined
                                ? updatedItems[item.productName]
                                : item.productQuantity
                            }
                            onChange={(e) =>
                              handleQuantityChange(item.productName, parseInt(e.target.value))
                            }
                            className="px-3 py-1.5 rounded-full bg-white border border-ink-200 text-sm font-semibold text-ink-800 focus:outline-none focus:border-brand-400 focus:shadow-focus cursor-pointer"
                          >
                            {[...Array(10).keys()].map((num) => (
                              <option key={num + 1} value={num + 1}>{num + 1}</option>
                            ))}
                          </select>
                          {editing && (
                            <button
                              onClick={() => handleUpdateQuantity(item.productName)}
                              className="px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold hover:bg-brand-100 transition-colors"
                            >
                              Update
                            </button>
                          )}
                        </div>
                        <p className="text-xl font-bold text-ink-900">
                          ${(Number(item.productPrice) * Number(item.productQuantity)).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <aside className="lg:col-span-4">
              <div className="lg:sticky lg:top-28 space-y-4">
                <div className="card p-6">
                  <h3 className="text-lg font-bold text-ink-900">Order summary</h3>

                  <div className="mt-4 space-y-3">
                    {sourcesInCart.map((src) => {
                      const group = itemsBySource[src];
                      const label = sellerLabel(src);
                      return (
                        <div key={src} className="flex justify-between text-sm">
                          <span className="text-ink-600">
                            {label} · {group.items.length} item{group.items.length === 1 ? '' : 's'}
                          </span>
                          <span className="text-ink-900 font-semibold">
                            ${group.subtotal.toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="border-t border-ink-100 pt-3 flex justify-between items-baseline">
                      <span className="text-sm font-medium text-ink-700">Subtotal</span>
                      <span className="text-2xl font-bold text-ink-900">
                        ${subTotal.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-ink-500">
                      Shipping and taxes are calculated by each seller at checkout.
                    </p>
                  </div>

                  {sourcesInCart.length > 1 && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-50/80 border border-amber-100 text-xs text-amber-800 leading-relaxed flex gap-2">
                      <FaInfoCircle className="shrink-0 mt-0.5" />
                      <span>
                        Your items come from {sourcesInCart.length} different sellers.
                        You'll check out with each one separately.
                      </span>
                    </div>
                  )}

                  <div className="mt-5 space-y-2.5">
                    {!currentUser ? (
                      <button
                        onClick={() => navigate('/login')}
                        className="btn-primary w-full !py-3.5 text-base"
                      >
                        <FaLock className="text-xs" /> Sign in to check out
                      </button>
                    ) : (
                      sourcesInCart.map((src) => {
                        const group = itemsBySource[src];
                        const label = sellerLabel(src);
                        return (
                          <button
                            key={src}
                            onClick={() => handleSourceCheckout(src)}
                            className="w-full inline-flex items-center justify-between gap-2 px-5 py-3.5 rounded-full font-semibold text-sm shadow-md hover:shadow-lg hover:brightness-105 active:scale-[0.98] transition-all text-white"
                            style={{
                              background:
                                src === 'amazon'
                                  ? 'linear-gradient(135deg,#FF9900,#FFB444)'
                                  : 'linear-gradient(135deg,#0071ce,#0a96f5)',
                              color: src === 'amazon' ? '#111' : '#fff',
                            }}
                          >
                            <span className="flex items-center gap-2">
                              Continue on {label}
                              <FaArrowRight className="text-xs" />
                            </span>
                            <span className="text-xs opacity-90">
                              ${group.subtotal.toFixed(2)}
                            </span>
                          </button>
                        );
                      })
                    )}
                    <button
                      onClick={() => navigate('/home')}
                      className="btn-secondary w-full"
                    >
                      Continue shopping
                    </button>
                  </div>
                </div>

                <div className="glass rounded-2xl p-4 text-xs text-ink-600 flex gap-2 leading-relaxed">
                  <FaLock className="text-brand-500 mt-0.5 shrink-0" />
                  <span>
                    Trendy Treasures never sees your payment details. Each
                    seller processes your card on their own secure checkout.
                  </span>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

export default Cart;
