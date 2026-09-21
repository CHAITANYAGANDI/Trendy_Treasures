import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { handleError, handleSuccess, API_BASE, apiFetch, googleErrorMessage, readApiError } from '../utils';
import AuthLayout from './AuthLayout';
import FormErrorBanner from './FormErrorBanner';
import { Field } from './ui/Primitives';
import GoogleGlyph from './ui/GoogleGlyph';

function Signin() {
    const [loginInfo, setLoginInfo] = useState({ email: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const [errorBanner, setErrorBanner] = useState('');
    const [showPassword, setShowPassword] = useState(false);
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
            title="Sign in"
            subtitle="Your saved cart, price alerts and tracked products, wherever you are."
            footer={
                <>
                    Don't have an account?{' '}
                    <Link to="/signup" className="link font-medium">Create one</Link>
                </>
            }
        >
            {errorBanner && (
                <div className="mb-5">
                    <FormErrorBanner message={errorBanner} />
                </div>
            )}

            <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <Field
                    id="email"
                    name="email"
                    type="email"
                    label="Email"
                    value={loginInfo.email}
                    onChange={handleChange}
                    autoFocus
                    autoComplete="email"
                    spellCheck="false"
                />
                <Field
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    label="Password"
                    value={loginInfo.password}
                    onChange={handleChange}
                    autoComplete="current-password"
                    trailing={
                        <button
                            type="button"
                            className="field-reveal"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    }
                />

                <p className="text-right">
                    <Link to="/forgotpassword" className="link t-ui">Forgot password?</Link>
                </p>

                <button type="submit" disabled={submitting} className="btn btn-blue btn-lg btn-full mt-2">
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
            </form>

            <div className="auth-divider my-6">or</div>

            <form action={`${API_BASE}/auth/google`} method="GET">
                <button type="submit" className="btn btn-quiet btn-lg btn-full">
                    <GoogleGlyph /> Continue with Google
                </button>
            </form>
        </AuthLayout>
    );
}

export default Signin;
