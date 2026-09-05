import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { handleSuccess, authFetch, googleErrorMessage } from '../utils';
import GoogleSignInButton, { GoogleDivider } from './GoogleSignInButton';

const ACCENT = '#426fe7';

function AuthLogin() {
    const [loginInfo, setLoginInfo] = useState({
        username: '',
        password: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [errorBanner, setErrorBanner] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Google sign-in failures arrive as a redirect to
    // /auth/login?error=<code> — the OAuth round-trip is a full page
    // navigation, so there is no fetch response to read. Surface the
    // reason, then strip the param so a refresh does not resurrect it.
    useEffect(() => {
        const code = searchParams.get('error');
        if (!code) return;
        setErrorBanner(googleErrorMessage(code));
        searchParams.delete('error');
        setSearchParams(searchParams, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const body = document.body;
        const root = document.getElementById('root');
        const prev = {
            bodyDisplay: body.style.display,
            bodyAlignItems: body.style.alignItems,
            bodyJustifyContent: body.style.justifyContent,
            bodyMinHeight: body.style.minHeight,
            bodyBackground: body.style.background,
            rootWidth: root ? root.style.width : '',
            rootMinHeight: root ? root.style.minHeight : ''
        };
        body.style.display = 'block';
        body.style.alignItems = 'stretch';
        body.style.justifyContent = 'flex-start';
        body.style.minHeight = '100vh';
        body.style.background = '#f8f9ff';
        if (root) {
            root.style.width = '100%';
            root.style.minHeight = '100vh';
        }
        return () => {
            body.style.display = prev.bodyDisplay;
            body.style.alignItems = prev.bodyAlignItems;
            body.style.justifyContent = prev.bodyJustifyContent;
            body.style.minHeight = prev.bodyMinHeight;
            body.style.background = prev.bodyBackground;
            if (root) {
                root.style.width = prev.rootWidth;
                root.style.minHeight = prev.rootMinHeight;
            }
        };
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setLoginInfo({ ...loginInfo, [name]: value });
        if (errorBanner) setErrorBanner('');
    };

    const handleAuthLogin = async (e) => {
        e.preventDefault();

        const { username, password } = loginInfo;

        if (!username || !password) {
            return setErrorBanner('Please enter both username and password.');
        }

        setSubmitting(true);
        setErrorBanner('');

        try {
            const response = await authFetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(loginInfo)
            });

            const result = await response.json().catch(() => ({}));
            const { success, message, error } = result;

            if (response.ok && success) {
                handleSuccess('Login successful');
                navigate('/auth/dashboard');
                return;
            }

            if (response.status === 403) {
                setErrorBanner('Incorrect username or password. Please try again.');
            } else if (error && error.details && error.details[0]) {
                setErrorBanner(error.details[0].message);
            } else {
                setErrorBanner(message || 'Could not sign you in. Please try again.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="font-body antialiased min-h-screen w-full flex items-center justify-center bg-[#f8f9ff] text-[#0b1c30] p-6">
            <div className="w-full max-w-md">
                <div className="flex items-center gap-3 mb-8 justify-center">
                    <span
                        className="material-symbols-outlined fill text-5xl"
                        style={{ color: ACCENT }}
                    >
                        shield
                    </span>
                    <span className="font-headline font-bold text-4xl tracking-tight text-[#0b1c30]">
                        AuthShield
                    </span>
                </div>

                <div
                    className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#e5eeff] border-b-2 p-8 sm:p-10"
                    style={{ borderBottomColor: ACCENT }}
                >
                    <div className="text-center mb-8">
                        <h2 className="font-headline font-bold text-3xl text-[#0b1c30] mb-2 text-center">
                            Welcome
                        </h2>
                        <p className="font-body text-sm text-[#5f5e5e] text-center">
                            Log in to Auth Shield to continue to the Auth Shield Dashboard.
                        </p>
                    </div>

                    {errorBanner && (
                        <div
                            className="text-sm rounded p-3 mb-5 flex items-start gap-2"
                            style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#b91c1c',
                                border: '1px solid rgba(239, 68, 68, 0.3)'
                            }}
                            role="alert"
                        >
                            <span className="material-symbols-outlined text-base mt-px">error</span>
                            <span>{errorBanner}</span>
                        </div>
                    )}

                    <form onSubmit={handleAuthLogin} className="space-y-5">
                        <div>
                            <label
                                className="block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5"
                                htmlFor="username"
                            >
                                Username
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                                        alternate_email
                                    </span>
                                </div>
                                <input
                                    id="username"
                                    name="username"
                                    type="text"
                                    value={loginInfo.username}
                                    onChange={handleChange}
                                    required
                                    className="block w-full pl-10 pr-3 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                />
                            </div>
                        </div>

                        <div>
                            <label
                                className="block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5"
                                htmlFor="password"
                            >
                                Password
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                                        lock
                                    </span>
                                </div>
                                <input
                                    id="password"
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={loginInfo.password}
                                    onChange={handleChange}
                                    required
                                    className="block w-full pl-10 pr-10 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer bg-transparent border-0"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    <span className="material-symbols-outlined text-[#5f5e5e] text-lg hover:text-[#0b1c30] transition-colors">
                                        {showPassword ? 'visibility' : 'visibility_off'}
                                    </span>
                                </button>
                            </div>
                            <div className="mt-1.5 text-right">
                                <Link
                                    to="/auth/forgot-password"
                                    className="font-body text-xs font-medium hover:underline"
                                    style={{ color: ACCENT }}
                                >
                                    Forgot password?
                                </Link>
                            </div>
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded shadow-sm text-lg font-headline font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer text-center disabled:opacity-60 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: ACCENT,
                                    color: '#ffffff'
                                }}
                            >
                                {submitting ? 'Signing in…' : 'Log In'}
                                {!submitting && (
                                    <span className="material-symbols-outlined ml-2 text-lg">
                                        arrow_forward
                                    </span>
                                )}
                            </button>
                        </div>
                    </form>

                    <GoogleDivider />
                    <GoogleSignInButton label="Sign in with Google" />

                    <div className="mt-8 pt-6 border-t border-[#dce9ff] text-center">
                        <p className="font-body text-sm">
                            <span className="text-[#0b1c30]">Don't have an account?</span>{' '}
                            <Link
                                to="/auth/register"
                                className="font-headline font-medium transition-colors hover:underline"
                                style={{ color: ACCENT }}
                            >
                                Sign up
                            </Link>
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default AuthLogin;
