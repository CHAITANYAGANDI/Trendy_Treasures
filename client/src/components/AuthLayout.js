import React from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';

/**
 * The shell wrapping every auth and recovery form, plus admin sign-in.
 *
 * The previous two-column split gave half the screen to marketing copy on a
 * page whose only job is a four-line form. This is a single centred column
 * instead — Apple Account's own shape — so the form is what you look at.
 *
 * `dark` switches the page to the black appearance used by the admin
 * portal. The change of appearance is itself the signal that you have left
 * the storefront.
 */
function AuthLayout({ title, subtitle, children, footer, eyebrow = null, dark = false }) {
  return (
    <div className={`authpage ${dark ? 'authpage-dark' : ''}`}>
      <div className="authcol">
        <Link
          to={dark ? '/admin/users' : '/home'}
          className="flex justify-center mb-7"
          aria-label="Trendy Treasures"
        >
          <BrandMark className="w-8 h-8" />
        </Link>

        {eyebrow && (
          <p className="flex justify-center mb-4">
            <span
              className={`inline-flex items-center h-7 px-3.5 rounded-pill text-cap border ${
                dark ? 'border-[#38383a] text-[#a1a1a6]' : 'border-hairline dim'
              }`}
            >
              {eyebrow}
            </span>
          </p>
        )}

        <h1 className="t-h1 text-center">{title}</h1>
        {subtitle && (
          <p
            className={`t-body text-center mt-2.5 leading-relaxed ${
              dark ? 'text-[#a1a1a6]' : 'dim'
            }`}
          >
            {subtitle}
          </p>
        )}

        <div className="mt-8">{children}</div>

        {footer && (
          <>
            <hr className={`rule my-7 ${dark ? '!bg-[#38383a]' : ''}`} />
            <p className={`t-ui text-center ${dark ? 'text-[#a1a1a6]' : 'dim'}`}>{footer}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthLayout;
