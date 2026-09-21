import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { handleSuccess, apiFetch, isStrongPassword, STRONG_PASSWORD_MESSAGE } from '../utils';
import AuthLayout from './AuthLayout';
import FormErrorBanner from './FormErrorBanner';
import PasswordStrengthHint from './PasswordStrengthHint';
import { Field } from './ui/Primitives';

function Signup() {
    const [signupInfo, setSignupInfo] = useState({ name: '', email: '', password: '' });
    const [errorBanner, setErrorBanner] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSignupInfo((prev) => ({ ...prev, [name]: value }));
        if (errorBanner) setErrorBanner('');
    };

    const handleSignup = async (e) => {
        e.preventDefault();
        const { name, email, password } = signupInfo;

        if (!name || !email || !password) {
            return setErrorBanner('Name, email, and password are required');
        }

        if (!isStrongPassword(password)) {
            return setErrorBanner(STRONG_PASSWORD_MESSAGE);
        }

        setSubmitting(true);
        setErrorBanner('');
        try {
            const response = await apiFetch('/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signupInfo),
            });
            const result = await response.json().catch(() => ({}));
            const { success, message, error } = result;
            if (response.ok && success) {
                handleSuccess(message);
                setTimeout(() => navigate('/verify-signup'), 800);
            } else if (error) {
                setErrorBanner(error?.details?.[0]?.message || 'Signup failed');
            } else {
                setErrorBanner(message || 'Signup failed. Please try again.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title="Create your account"
            subtitle="One account for both stores. It takes under a minute."
            footer={
                <>
                    Already have an account?{' '}
                    <Link to="/login" className="link font-medium">Sign in</Link>
                </>
            }
        >
            <form onSubmit={handleSignup} className="flex flex-col gap-3">
                <FormErrorBanner message={errorBanner} />

                <Field
                    id="name"
                    name="name"
                    label="Full name"
                    value={signupInfo.name}
                    onChange={handleChange}
                    autoFocus
                    autoComplete="name"
                />
                <Field
                    id="email"
                    name="email"
                    type="email"
                    label="Email"
                    value={signupInfo.email}
                    onChange={handleChange}
                    autoComplete="email"
                    spellCheck="false"
                />
                <div>
                    <Field
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        label="Password"
                        value={signupInfo.password}
                        onChange={handleChange}
                        autoComplete="new-password"
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
                    <PasswordStrengthHint password={signupInfo.password} />
                </div>

                <button type="submit" disabled={submitting} className="btn btn-blue btn-lg btn-full mt-2">
                    {submitting ? 'Creating account…' : 'Create account'}
                </button>

                <p className="text-cap dim text-center leading-relaxed mt-1">
                    By creating an account, you agree to our terms. We'll email you a
                    4-digit code to verify it's really you.
                </p>
            </form>
        </AuthLayout>
    );
}

export default Signup;
