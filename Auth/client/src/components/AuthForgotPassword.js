import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    handleError,
    handleSuccess,
    AUTH_API_BASE,
    isStrongPassword,
    STRONG_PASSWORD_MESSAGE
} from '../utils';

const ACCENT = '#426fe7';

const LABEL_CLASS =
    'block w-full pl-0 ml-0 text-left font-headline font-medium text-sm text-[#0b1c30] mb-1.5';
const INPUT_CLASS =
    'block w-full py-2.5 border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] sm:text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow';
const PRIMARY_BUTTON_CLASS =
    'w-full flex justify-center items-center py-3 px-4 border border-transparent rounded shadow-sm text-base font-headline font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

// request → verify → reset. The new-password fields only appear once the
// server has accepted the mailed code.
const STEPS = {
    request: {
        title: 'Forgot password',
        subtitle: () =>
            "Enter the email tied to your AuthShield account and we'll send you a 6-digit reset code."
    },
    verify: {
        title: 'Enter reset code',
        subtitle: (email) => `We sent a 6-digit code to ${email}. Enter it below to continue.`
    },
    reset: {
        title: 'Set a new password',
        subtitle: (email) => `Choose a new password for ${email}.`
    }
};

// Server codes that mean the mailed code is gone — the only way forward is
// requesting a fresh one.
const CODE_GONE_MESSAGE = {
    OTP_EXPIRED: 'That code has expired. Request a new one below.',
    OTP_LOCKED: 'Too many incorrect attempts. Request a new code below.'
};

const postJson = async (path, body) => {
    const res = await fetch(`${AUTH_API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    const result = await res.json().catch(() => ({}));
    return { ok: res.ok && result.success, result };
};

function Banner({ banner }) {
    if (!banner) return null;
    const success = banner.severity === 'success';
    return (
        <div
            className="text-sm text-left rounded p-3 mb-5 flex items-start gap-2"
            style={{
                background: success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: success ? '#047857' : '#b91c1c',
                border: `1px solid ${success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}
            role={success ? 'status' : 'alert'}
        >
            <span className="material-symbols-outlined text-base mt-px">
                {success ? 'check_circle' : 'error'}
            </span>
            <span>{banner.message}</span>
        </div>
    );
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoFocus, hint }) {
    return (
        <div>
            <label className={LABEL_CLASS} htmlFor={id}>
                {label}
            </label>
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-[#5f5e5e] text-lg">lock</span>
                </div>
                <input
                    id={id}
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={onChange}
                    required
                    autoFocus={autoFocus}
                    autoComplete="new-password"
                    className={`${INPUT_CLASS} pl-10 ${onToggle ? 'pr-10' : 'pr-3'}`}
                />
                {onToggle && (
                    <button
                        type="button"
                        onClick={onToggle}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer bg-transparent border-0"
                        aria-label={show ? 'Hide password' : 'Show password'}
                    >
                        <span className="material-symbols-outlined text-[#5f5e5e] text-lg">
                            {show ? 'visibility' : 'visibility_off'}
                        </span>
                    </button>
                )}
            </div>
            {hint}
        </div>
    );
}

function AuthForgotPassword() {
    const navigate = useNavigate();

    const [step, setStep] = useState('request');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [banner, setBanner] = useState(null); // { severity, message }

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

    const trimmedEmail = email.trim();

    // Back to step 1 — used by "Use a different email" and whenever the code
    // has expired or been locked.
    const startOver = (nextBanner = null) => {
        setStep('request');
        setOtp('');
        setNewPassword('');
        setConfirmNewPassword('');
        setBanner(nextBanner);
    };

    const handleRequestOtp = async (e) => {
        e.preventDefault();
        if (!trimmedEmail) {
            return handleError('Email is required');
        }
        setSubmitting(true);
        setBanner(null);
        try {
            const { ok, result } = await postJson('/forgot-password', { email: trimmedEmail });
            if (ok) {
                setOtp('');
                setStep('verify');
                setBanner({
                    severity: 'success',
                    message:
                        'If an account exists for that email, a 6-digit code is on its way. Check your inbox (and spam).'
                });
                handleSuccess('Reset code sent');
            } else {
                setBanner({
                    severity: 'error',
                    message: result.message || 'Could not start password reset.'
                });
            }
        } catch (err) {
            setBanner({ severity: 'error', message: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(otp)) {
            return setBanner({ severity: 'error', message: 'Enter the 6-digit code from your email.' });
        }
        setSubmitting(true);
        setBanner(null);
        try {
            const { ok, result } = await postJson('/verify-reset-code', { email: trimmedEmail, otp });
            if (ok) {
                setStep('reset');
                setBanner({ severity: 'success', message: 'Code verified.' });
            } else if (CODE_GONE_MESSAGE[result.code]) {
                startOver({ severity: 'error', message: CODE_GONE_MESSAGE[result.code] });
            } else {
                setOtp('');
                setBanner({ severity: 'error', message: result.message || 'Could not verify the code.' });
            }
        } catch (err) {
            setBanner({ severity: 'error', message: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!newPassword || !confirmNewPassword) {
            return setBanner({ severity: 'error', message: 'Enter and confirm your new password.' });
        }
        if (newPassword !== confirmNewPassword) {
            return setBanner({ severity: 'error', message: 'Passwords do not match.' });
        }
        if (!isStrongPassword(newPassword)) {
            return setBanner({ severity: 'error', message: STRONG_PASSWORD_MESSAGE });
        }
        setSubmitting(true);
        setBanner(null);
        try {
            const { ok, result } = await postJson('/reset-password', {
                email: trimmedEmail,
                otp,
                newPassword
            });
            if (ok) {
                handleSuccess('Password reset');
                navigate('/auth/login', {
                    replace: true,
                    state: {
                        identifier: trimmedEmail,
                        notice: 'Password reset. Sign in with your email or username and your new password.'
                    }
                });
                return;
            }
            if (CODE_GONE_MESSAGE[result.code]) {
                startOver({
                    severity: 'error',
                    message:
                        result.code === 'OTP_EXPIRED'
                            ? 'Your code expired before the password was saved. Request a new one below.'
                            : CODE_GONE_MESSAGE[result.code]
                });
            } else {
                setBanner({ severity: 'error', message: result.message || 'Could not reset password.' });
            }
        } catch (err) {
            setBanner({ severity: 'error', message: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    const passwordsMismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

    const useDifferentEmail = (
        <button
            type="button"
            onClick={() => startOver()}
            className="text-xs font-medium underline bg-transparent border-0 cursor-pointer"
            style={{ color: '#5f5e5e' }}
        >
            Use a different email
        </button>
    );

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
                            {STEPS[step].title}
                        </h2>
                        <p className="font-body text-sm text-[#5f5e5e] text-center">
                            {STEPS[step].subtitle(trimmedEmail)}
                        </p>
                    </div>

                    <Banner banner={banner} />

                    {step === 'request' && (
                        <form onSubmit={handleRequestOtp} className="space-y-5">
                            <div>
                                <label className={LABEL_CLASS} htmlFor="email">
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
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        autoComplete="email"
                                        className={`${INPUT_CLASS} pl-10 pr-3`}
                                    />
                                </div>
                            </div>
                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className={PRIMARY_BUTTON_CLASS}
                                    style={{ backgroundColor: ACCENT, color: '#ffffff' }}
                                >
                                    {submitting ? 'Sending…' : 'Send reset code'}
                                </button>
                            </div>
                        </form>
                    )}

                    {step === 'verify' && (
                        <form onSubmit={handleVerifyOtp} className="space-y-5">
                            <div>
                                <label className={LABEL_CLASS} htmlFor="otp">
                                    Reset code
                                </label>
                                <input
                                    id="otp"
                                    inputMode="numeric"
                                    pattern="\d{6}"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    required
                                    autoFocus
                                    autoComplete="one-time-code"
                                    className="block w-full px-3 py-2.5 text-center tracking-[0.4em] font-mono text-lg border border-[#dce9ff] rounded bg-[#f8f9ff] text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#426fe7] focus:border-[#426fe7] transition-shadow"
                                />
                            </div>
                            <div className="pt-2 flex flex-col gap-2">
                                <button
                                    type="submit"
                                    disabled={submitting || otp.length !== 6}
                                    className={PRIMARY_BUTTON_CLASS}
                                    style={{ backgroundColor: ACCENT, color: '#ffffff' }}
                                >
                                    {submitting ? 'Verifying…' : 'Verify code'}
                                </button>
                                {useDifferentEmail}
                            </div>
                        </form>
                    )}

                    {step === 'reset' && (
                        <form onSubmit={handleResetPassword} className="space-y-5">
                            <PasswordField
                                id="newPassword"
                                label="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                show={showPassword}
                                onToggle={() => setShowPassword((v) => !v)}
                                autoFocus
                                hint={
                                    <p className="mt-1.5 text-left text-xs text-[#5f5e5e]">
                                        {STRONG_PASSWORD_MESSAGE}
                                    </p>
                                }
                            />
                            <PasswordField
                                id="confirmNewPassword"
                                label="Confirm new password"
                                value={confirmNewPassword}
                                onChange={(e) => setConfirmNewPassword(e.target.value)}
                                show={showPassword}
                                hint={
                                    passwordsMismatch && (
                                        <p className="mt-1.5 text-left text-xs" style={{ color: '#b91c1c' }}>
                                            Passwords do not match.
                                        </p>
                                    )
                                }
                            />
                            <div className="pt-2 flex flex-col gap-2">
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className={PRIMARY_BUTTON_CLASS}
                                    style={{ backgroundColor: ACCENT, color: '#ffffff' }}
                                >
                                    {submitting ? 'Resetting…' : 'Reset password'}
                                </button>
                                {useDifferentEmail}
                            </div>
                        </form>
                    )}

                    <div className="mt-8 pt-6 border-t border-[#dce9ff] text-center">
                        <p className="font-body text-sm">
                            <Link
                                to="/auth/login"
                                className="font-headline font-medium transition-colors hover:underline"
                                style={{ color: ACCENT }}
                            >
                                ← Back to sign in
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AuthForgotPassword;
