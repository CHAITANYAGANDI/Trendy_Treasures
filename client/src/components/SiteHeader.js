import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Bell, LogOut, Trash2, LogIn, User, ChevronDown } from 'lucide-react';
import { handleCartClick, handleError, handleSuccess, apiFetch, logoutUser, showConfirm } from '../utils';
import BrandMark from './BrandMark';

/**
 * The 56px translucent bar on every storefront page — taller than Apple's
 * 44px marketing bar because this one carries a working search field.
 *
 * Brand, optional search (controlled by the page), cart badge and the
 * account menu. Everything the previous header did, it still does.
 */
function SiteHeader({
  currentUser,
  setCurrentUser,
  cartCount = 0,
  searchValue,
  onSearchChange,
  showSearch = true,
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Close the dropdown when the user clicks outside of it.
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Escape closes the menu too, so the keyboard can get back out of it.
  useEffect(() => {
    if (!showDropdown) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowDropdown(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showDropdown]);

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser && setCurrentUser(null);
    setShowDropdown(false);
    handleSuccess('Logged out successfully');
    setTimeout(() => navigate('/login'), 800);
  };

  const handleDeleteAccount = async () => {
    if (!currentUser || !currentUser.email) {
      handleError('No user email found');
      return;
    }
    const ok = await showConfirm({
      title: 'Delete your account?',
      body: 'This will permanently remove your account, saved cart, and order history. This cannot be undone.',
      confirmLabel: 'Delete account',
      cancelLabel: 'Keep account',
      danger: true
    });
    if (!ok) return;

    try {
      const response = await apiFetch(`/account/delete/${currentUser.email}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        handleSuccess('Account deleted successfully');
        await logoutUser();
        setCurrentUser && setCurrentUser(null);
        setShowDropdown(false);
        setTimeout(() => navigate('/signup'), 1200);
      } else {
        const errorData = await response.json();
        handleError(errorData.message || 'Failed to delete account');
      }
    } catch (error) {
      handleError(error.message || 'An error occurred while deleting the account');
    }
  };

  const initial = currentUser?.name?.[0]?.toUpperCase() || '';

  const searchField = (
    <label className="search">
      <Search size={15} aria-hidden="true" className="shrink-0" />
      <input
        type="search"
        value={searchValue || ''}
        onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
        placeholder="Search products"
        aria-label="Search products"
      />
    </label>
  );

  return (
    <header className="nav">
      <div className="nav-inner">
        {/* Brand is the gem alone, the way Apple's global nav is the logo
            alone. The name is carried by the footer and the page title. */}
        <Link to="/home" className="nav-mark" aria-label="Trendy Treasures — home">
          <BrandMark className="w-7 h-7 shrink-0" />
        </Link>

        {/* Search — the centre column of the bar */}
        {showSearch ? (
          <div className="hidden md:block nav-search">{searchField}</div>
        ) : (
          <div className="hidden md:block" />
        )}

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => handleCartClick(navigate)}
            className="nav-icon"
            aria-label={cartCount > 0 ? `Open cart, ${cartCount} items` : 'Open cart'}
          >
            <ShoppingBag size={19} aria-hidden="true" />
            {cartCount > 0 && (
              <span className="nav-badge">{cartCount > 99 ? '99+' : cartCount}</span>
            )}
          </button>

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowDropdown((v) => !v)}
              className="nav-account"
              aria-haspopup="menu"
              aria-expanded={showDropdown}
              aria-label={currentUser ? 'Account menu' : 'Sign in'}
            >
              {currentUser ? (
                <span className="nav-initial" aria-hidden="true">{initial}</span>
              ) : (
                <User size={19} className="dim" aria-hidden="true" />
              )}
              <span className="hidden lg:inline t-ui font-medium max-w-[120px] truncate">
                {currentUser ? currentUser.name : 'Sign in'}
              </span>
              <ChevronDown size={13} className="dimmer hidden lg:block" aria-hidden="true" />
            </button>

            {showDropdown && (
              <div className="menu absolute right-0 top-[46px] z-[95] animate-popIn" role="menu">
                {currentUser ? (
                  <>
                    <div className="menu-head">
                      <p className="t-ui font-medium truncate">{currentUser.name}</p>
                      <p className="text-cap dimmer truncate mt-0.5">{currentUser.email}</p>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowDropdown(false);
                        navigate('/alerts');
                      }}
                    >
                      <Bell size={16} aria-hidden="true" />
                      Price alerts
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={handleDeleteAccount}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Delete account
                    </button>
                    {/* Log out sits last — it is the item people reach for
                        most, and the one that should be furthest from the
                        destructive action above it. */}
                    <button type="button" role="menuitem" onClick={handleLogout}>
                      <LogOut size={16} aria-hidden="true" />
                      Log out
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowDropdown(false);
                      navigate('/login');
                    }}
                  >
                    <LogIn size={16} aria-hidden="true" />
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search — its own row below 768, where the three-column grid would
          squeeze it to nothing. */}
      {showSearch && (
        <div className="md:hidden shell-wide pb-2.5 -mt-0.5">{searchField}</div>
      )}
    </header>
  );
}

export default SiteHeader;
