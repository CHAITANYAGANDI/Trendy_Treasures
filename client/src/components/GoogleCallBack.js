import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, fetchCurrentUser, finishSignIn, peekSignInReturn, takeSignInReturn } from '../utils';
import BrandMark from './BrandMark';
import { Spinner } from './ui/Primitives';

function GoogleAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    async function completeGoogleSignIn() {
      // Where the shopper was before leaving for Google (see Signin). On a
      // failure it goes back with them, so trying again still returns there.
      // Peeked, not taken: StrictMode runs this effect twice in development,
      // and an abandoned first run mustn't consume it. Cleared on the way out.
      const returnState = peekSignInReturn();

      // /authenticate consumes the one-shot `userInfo` handoff cookie. It
      // is only a nicety though — the real proof of sign-in is the session
      // cookie, so a miss here (already consumed, page refreshed) falls
      // back to /auth/me before we declare failure.
      try {
        const response = await apiFetch('/authenticate');
        if (!mounted) return;
        if (response.ok) {
          takeSignInReturn();
          await finishSignIn(navigate, returnState);
          return;
        }
      } catch (error) {
        console.error('Error handling Google callback:', error);
      }

      const user = await fetchCurrentUser();
      if (!mounted) return;
      takeSignInReturn();
      if (user) await finishSignIn(navigate, returnState);
      else navigate('/login?error=google_failed', { replace: true, state: returnState });
    }

    completeGoogleSignIn();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="authpage justify-center">
      <div className="authcol text-center">
        <BrandMark className="w-8 h-8 mx-auto" />
        <div className="flex justify-center mt-8">
          <Spinner />
        </div>
        <h1 className="t-h2 mt-6">Signing you in…</h1>
        <p className="t-body dim mt-2.5">
          Just a moment while we finish authenticating with Google.
        </p>
      </div>
    </div>
  );
}

export default GoogleAuthCallback;
