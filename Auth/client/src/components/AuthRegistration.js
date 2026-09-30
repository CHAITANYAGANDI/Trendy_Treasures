import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    handleSuccess,
    authFetch,
    scorePassword,
    STRONG_PASSWORD_THRESHOLD,
    STRONG_PASSWORD_MESSAGE,
    isValidUsername,
    USERNAME_MESSAGE
} from '../utils';
import GoogleSignInButton, { GoogleDivider } from './GoogleSignInButton';

const ACCENT = '#426fe7';

const STRENGTH_COLORS = ['#dce9ff', '#ef4444', '#f59e0b', '#eab308', '#10b981'];
const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

function AuthRegistration() {
    const [formData, setFormData] = useState({
        name: '',
        username: '',
        email: '',
        password: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [errorBanner, setErrorBanner] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Two-step signup: 'form' collects credentials and triggers the OTP email;
    // 'verify' shows the OTP entry that creates the account + auto-logs in.
    const [step, setStep] = useState('form');
    const [otp, setOtp] = useState('');
    const [otpEmail, setOtpEmail] = useState('');
    const [resending, setResending] = useState(false);

    const navigate = useNavigate();

    useEffect(() => {
        // Auth.css (imported globally by AuthLogin) puts `body { display:flex; align-items:center }`
        // which shrinks #root to its content. Override while this screen is mounted.
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
        setFormData({ ...formData, [name]: value });
        if (errorBanner) setErrorBanner('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const { name, username, email, password } = formData;

        if (!name || !username || !email || !password) {
            return setErrorBanner('All fields are required.');
        }

        if (!isValidUsername(username.trim())) {
            return setErrorBanner(USERNAME_MESSAGE);
        }

        if (scorePassword(password) < STRONG_PASSWORD_THRESHOLD) {
            return setErrorBanner(STRONG_PASSWORD_MESSAGE);
        }

        setSubmitting(true);
        setErrorBanner('');

        try {
            const response = await authFetch('/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json().catch(() => ({}));
            const { success, message, error, email: respEmail } = result;

            if (response.ok && success) {
                // Step 1 succeeded — server mailed an OTP and set the
                // pendingSignup cookie. Move to step 2 (OTP entry).
                setOtpEmail(respEmail || formData.email);
                setOtp('');
                setStep('verify');
                handleSuccess(message || 'Verification code sent. Check your inbox.');
                return;
            }

            if (error && error.details && error.details[0]) {
                setErrorBanner(error.details[0].message);
            } else {
                setErrorBanner(message || 'Could not create your account. Please try again.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        const code = String(otp || '').trim();
        if (!/^\d{6}$/.test(code)) {
            return setErrorBanner('Enter the 6-digit code from your email.');
        }

        setSubmitting(true);
        setErrorBanner('');

        try {
            const response = await authFetch('/register/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp: code })
            });

            const result = await response.json().catch(() => ({}));
            const { success, message } = result;

            if (response.ok && success) {
                handleSuccess(message || 'Account verified.');
                // verifySignupOtp already issued authToken + authRefreshToken,
                // so the user is logged in — drop them on the dashboard, in
                // place of the form so Back doesn't reopen it.
                navigate('/auth/dashboard', { replace: true });
                return;
            }

            // 401 = pendingSignup cookie missing/expired — send the user
            // back to step 1 so they can re-enter the form and re-trigger
            // the OTP email.
            if (response.status === 401) {
                setStep('form');
                setErrorBanner(message || 'Signup session expired. Please register again.');
                return;
            }

            setErrorBanner(message || 'Could not verify your code. Try again.');
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleResendOtp = async () => {
        if (resending) return;
        setResending(true);
        setErrorBanner('');
        try {
            // Re-POST the original form so the server re-mails a fresh code
            // and refreshes the pendingSignup cookie. The per-address resend
            // cooldown in the mailer absorbs accidental double-clicks.
            const response = await authFetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                handleSuccess('A new code has been sent to your email.');
                setOtp('');
            } else {
                setErrorBanner(result.message || 'Could not resend the code. Try again later.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="font-body antialiased min-h-screen flex bg-[#f8f9ff] text-[#0b1c30]">
            <div className="flex flex-col lg:flex-row w-full min-h-screen">
                <div
                    className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden text-white"
                    style={{ backgroundColor: '#000000' }}
                >
                    <div
                        className="absolute inset-0 opacity-10 pointer-events-none"
                        style={{
                            backgroundImage: 'radial-gradient(rgb(51,51,51) 1px, transparent 1px)',
                            backgroundSize: '24px 24px'
                        }}
                    />
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-16">
                            <span
                                className="material-symbols-outlined fill text-3xl"
                                style={{ color: ACCENT }}
                            >
                                shield
                            </span>
                            <span className="font-headline font-bold text-2xl tracking-tight text-white">
                                AuthShield
                            </span>
                        </div>
                        <div className="max-w-md text-left">
                            <h1 className="font-headline font-bold text-4xl mb-6 text-white leading-tight text-left">
                                Create an account to manage application access.
                            </h1>
                            <p
                                className="font-body text-lg mb-10 leading-relaxed text-left"
                                style={{ color: ACCENT }}
                            >
                                Register to set up your developer profile, manage application credentials,
                                and configure secure access for your integrations.
                            </p>
                            <div className="space-y-6">
                                <div className="flex items-start gap-4">
                                    <div
                                        className="p-2 rounded-lg"
                                        style={{ backgroundColor: 'rgba(66,111,231,0.2)' }}
                                    >
                                        <span
                                            className="material-symbols-outlined"
                                            style={{ color: ACCENT }}
                                        >
                                            vpn_key
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="font-headline font-semibold text-white mb-1">
                                            Application Credentials
                                        </h3>
                                        <p
                                            className="text-sm font-body"
                                            style={{ color: ACCENT }}
                                        >
                                            Create and manage a unique client ID and client secret for each
                                            registered application.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <div
                                        className="p-2 rounded-lg"
                                        style={{ backgroundColor: 'rgba(66,111,231,0.2)' }}
                                    >
                                        <span
                                            className="material-symbols-outlined"
                                            style={{ color: ACCENT }}
                                        >
                                            route
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="font-headline font-semibold text-white mb-1">
                                            API &amp; Redirect Configuration
                                        </h3>
                                        <p
                                            className="text-sm font-body"
                                            style={{ color: ACCENT }}
                                        >
                                            Add your API base URL and redirect URI so authorization callbacks
                                            land at the right endpoint every time.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#f8f9ff]">
                    <div className="w-full max-w-md">
                        <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
                            <span
                                className="material-symbols-outlined fill text-3xl"
                                style={{ color: ACCENT }}
                            >
                                shield
                            </span>
                            <span className="font-headline font-bold text-2xl text-[#0b1c30]">
                                AuthShield
                            </span>
                        </div>
                        <div
                            className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#e5eeff] border-b-2 p-8 sm:p-10"
                            style={{ borderBottomColor: ACCENT }}
                        >
                            <div className="text-left mb-8">
                                <h2 className="font-headline font-bold text-2xl text-[#0b1c30] mb-2 text-left">
                                    {step === 'verify' ? 'Verify Your Email' : 'Create Your Account'}
                                </h2>
                                {step === 'verify' && (
                                    <p className="font-body text-sm text-[#5f5e5e]">
                                        We sent a 6-digit code to{' '}
                                        <span className="font-medium text-[#0b1c30]">{otpEmail}</span>.
                                        Enter it below to finish creating your account.
                                    </p>
                                )}
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
                            {step === 'verify' ? (
                                <form onSubmit={handleVerifyOtp} className="space-y-5">
                                    <div>
                                        <label
                                            className="block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5"
                                            htmlFor="otp"
                                        >
                                            Verification Code
                                        </label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                                                    pin
                                                </span>
                                            </div>
                                            <input
                                                id="otp"
                                                name="otp"
                                                type="text"
                                                inputMode="numeric"
                                                pattern="\d{6}"
                                                maxLength={6}
                                                autoComplete="one-time-code"
                                                value={otp}
                                                onChange={(e) => {
                                                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                                                    if (errorBanner) setErrorBanner('');
                                                }}
                                                required
                                                className="block w-full pl-10 pr-3 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                            />
                                        </div>
                                        <p className="text-xs mt-1.5" style={{ color: '#5f5e5e' }}>
                                            The code expires in 10 minutes.
                                        </p>
                                    </div>
                                    <div className="pt-2">
                                        <button
                                            type="submit"
                                            disabled={submitting}
                                            className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded shadow-sm text-sm font-headline font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                            style={{
                                                backgroundColor: ACCENT,
                                                color: '#ffffff'
                                            }}
                                        >
                                            {submitting ? 'Verifying…' : 'Verify and Continue'}
                                            {!submitting && (
                                                <span className="material-symbols-outlined ml-2 text-sm">
                                                    arrow_forward
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between text-sm font-body pt-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setStep('form');
                                                setOtp('');
                                                setErrorBanner('');
                                            }}
                                            className="font-headline font-medium hover:underline cursor-pointer bg-transparent border-0 p-0"
                                            style={{ color: ACCENT }}
                                        >
                                            ← Edit details
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResendOtp}
                                            disabled={resending}
                                            className="font-headline font-medium hover:underline cursor-pointer bg-transparent border-0 p-0 disabled:opacity-60"
                                            style={{ color: ACCENT }}
                                        >
                                            {resending ? 'Resending…' : 'Resend code'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div>
                                    <label
                                        className="block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5"
                                        htmlFor="name"
                                    >
                                        Full Name
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                                                person
                                            </span>
                                        </div>
                                        <input
                                            id="name"
                                            name="name"
                                            type="text"
                                            value={formData.name}
                                            onChange={handleChange}
                                            required
                                            className="block w-full pl-10 pr-3 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                        />
                                    </div>
                                </div>
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
                                            value={formData.username}
                                            onChange={handleChange}
                                            required
                                            className="block w-full pl-10 pr-3 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label
                                        className="block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5"
                                        htmlFor="email"
                                    >
                                        Email
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                                                mail
                                            </span>
                                        </div>
                                        <input
                                            id="email"
                                            name="email"
                                            type="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            required
                                            autoComplete="email"
                                            className="block w-full pl-10 pr-3 py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                        />
                                    </div>
                                    <p className="text-xs mt-1.5" style={{ color: '#5f5e5e' }}>
                                        Used to recover your password if you forget it.
                                    </p>
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
                                            value={formData.password}
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
                                    {(() => {
                                        const score = scorePassword(formData.password);
                                        const activeColor = STRENGTH_COLORS[score];
                                        return (
                                            <>
                                                <div className="mt-2 flex gap-1">
                                                    {[1, 2, 3, 4].map((i) => (
                                                        <div
                                                            key={i}
                                                            className="h-1 w-full rounded-full transition-colors"
                                                            style={{
                                                                background:
                                                                    i <= score ? activeColor : '#dce9ff'
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                                <p
                                                    className="text-xs mt-1.5 font-body"
                                                    style={{
                                                        color: formData.password ? activeColor : ACCENT
                                                    }}
                                                >
                                                    {formData.password
                                                        ? `${STRENGTH_LABELS[score]} — use 8+ chars with upper/lower case, a number, and a symbol.`
                                                        : 'Use 8+ characters with a mix of letters, numbers, and symbols.'}
                                                </p>
                                            </>
                                        );
                                    })()}
                                </div>
                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded shadow-sm text-sm font-headline font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                        style={{
                                            backgroundColor: ACCENT,
                                            color: '#ffffff'
                                        }}
                                    >
                                        {submitting ? 'Creating account…' : 'Register Account'}
                                        {!submitting && (
                                            <span className="material-symbols-outlined ml-2 text-sm">
                                                arrow_forward
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </form>
                            )}

                            {step === 'form' && (
                                <>
                                    <GoogleDivider />
                                    <GoogleSignInButton label="Sign up with Google" />
                                </>
                            )}

                            <div className="mt-8 pt-6 border-t border-[#dce9ff] text-center">
                                <p className="font-body text-sm">
                                    <span className="text-[#0b1c30]">Already have an account?</span>{' '}
                                    <Link
                                        to="/auth/login"
                                        className="font-headline font-medium transition-colors hover:underline"
                                        style={{ color: ACCENT }}
                                    >
                                        Sign in
                                    </Link>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AuthRegistration;
