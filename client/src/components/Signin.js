import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FaArrowRight, FaGoogle } from 'react-icons/fa';
import { handleError, handleSuccess, API_BASE, apiFetch, googleErrorMessage, readApiError } from '../utils';
import AuthLayout from './AuthLayout';
import FormErrorBanner from './FormErrorBanner';

function Signin() {
    const [loginInfo, setLoginInfo] = useState({ email: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const [errorBanner, setErrorBanner] = useState('');
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Google sign-in failures come back as a redirect to /login?error=<code>
    // (the OAuth round-trip is a full page navigation, so there is no fetch
    // response to read). Surface the reason, then strip the param so a
    // refresh does not resurrect a stale banner.
    useEffect(() => {
        const code = searchParams.get('error');
        if (!code) return;
        setErrorBanner(googleErrorMessage(code));
        searchParams.delete('error');
        setSearchParams(searchParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setLoginInfo((prev) => ({ ...prev, [name]: value }));
        if (errorBanner) setErrorBanner('');
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        const { email, password } = loginInfo;

        if (!email || !password) {
            return handleError('Email and password are required');
        }

        setSubmitting(true);
        try {
            const response = await apiFetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loginInfo),
            });

            if (!response.ok) {
                // Same reasoning as AdminLogin: branch on status, not on the
                // shape of a body that may not even be JSON.
                handleError(await readApiError(response, 'Login failed'));
                return;
            }

            const result = await response.json().catch(() => ({}));
            if (result.success) {
                handleSuccess(result.message);
                setTimeout(() => navigate('/home'), 800);
            } else {
                handleError(result.message || 'Login failed');
            }
        } catch (err) {
            handleError(err.message || 'Login failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title="Welcome back"
            subtitle="Sign in to access your saved cart, price alerts, and tracked products."
            panelTitle="Your prices, tracked. Your cart, saved."
            panelSubtitle="Sign in to see your price alerts, watched products, and saved items right where you left them — across every store."
            footer={
                <>
                    Don't have an account?{' '}
                    <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
                        Create one
                    </Link>
                </>
            }
        >
            {errorBanner && (
                <div className="mb-4">
                    <FormErrorBanner message={errorBanner} />
                </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
                <div>
                    <label htmlFor="email" className="field-label">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoFocus
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={loginInfo.email}
                        onChange={handleChange}
                        className="field-input"
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="password" className="field-label !mb-0">Password</label>
                        <Link to="/forgotpassword" className="text-xs font-semibold text-brand-700 hover:underline">
                            Forgot password?
                        </Link>
                    </div>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={loginInfo.password}
                        onChange={handleChange}
                        className="field-input"
                    />
                </div>

                <button type="submit" disabled={submitting} className="btn-primary w-full !py-3.5">
                    {submitting ? 'Signing in…' : <>Sign in <FaArrowRight className="text-xs" /></>}
                </button>
            </form>

            <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-ink-200" />
                <span className="text-xs text-ink-400 font-medium uppercase tracking-wider">
                    or
                </span>
                <div className="flex-1 h-px bg-ink-200" />
            </div>

            <form action={`${API_BASE}/auth/google`} method="GET">
                <button type="submit" className="btn-secondary w-full !py-3.5">
                    <FaGoogle className="text-brand-600" /> Continue with Google
                </button>
            </form>
        </AuthLayout>
    );
}

export default Signin;
