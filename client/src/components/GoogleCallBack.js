import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, fetchCurrentUser } from '../utils';

function GoogleAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    async function completeGoogleSignIn() {
      // /authenticate consumes the one-shot `userInfo` handoff cookie. It
      // is only a nicety though — the real proof of sign-in is the session
      // cookie, so a miss here (already consumed, page refreshed) falls
      // back to /auth/me before we declare failure.
      try {
        const response = await apiFetch('/authenticate');
        if (!mounted) return;
        if (response.ok) {
          navigate('/home', { replace: true });
          return;
        }
      } catch (error) {
        console.error('Error handling Google callback:', error);
      }

      const user = await fetchCurrentUser();
      if (!mounted) return;
      if (user) navigate('/home', { replace: true });
      else navigate('/login?error=google_failed', { replace: true });
    }

    completeGoogleSignIn();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card p-10 max-w-md w-full text-center animate-fade-in">
        <div className="w-12 h-12 mx-auto rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
        <h2 className="mt-5 text-xl font-bold text-ink-900">Signing you in…</h2>
        <p className="text-sm text-ink-500 mt-2">
          Just a moment while we finish authenticating with Google.
        </p>
      </div>
    </div>
  );
}

export default GoogleAuthCallback;
