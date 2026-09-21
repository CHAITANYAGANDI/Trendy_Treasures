import React from 'react';
import { Link } from 'react-router-dom';
import BrandMark, { Wordmark } from './BrandMark';

/**
 * A haze band closing every storefront page: the brand lockup and the same
 * five links the previous footer carried. No added claims, no invented
 * pages.
 */
function SiteFooter() {
  return (
    <footer className="foot">
      <div className="shell-wide">
        <div className="foot-cols">
          <div className="col-span-2 md:col-span-1">
            <Link to="/home" className="foot-mark inline-flex items-center gap-2 text-ink no-underline">
              <BrandMark className="w-[22px] h-[22px]" />
              <Wordmark className="text-ui" />
            </Link>
          </div>

          <div>
            <h5>Shop</h5>
            <Link to="/home">All products</Link>
            <Link to="/cart">Cart</Link>
          </div>

          <div>
            <h5>Account</h5>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <Link to="/forgotpassword">Forgot password</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
