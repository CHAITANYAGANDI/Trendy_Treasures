import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { handleError, handleSuccess, apiFetch } from '../utils';
import AuthLayout from './AuthLayout';
import { Field } from './ui/Primitives';

// Admins and customers both live in the users collection and the
// /recovery/* endpoints look accounts up by email with no role filter, so
// the admin flow is this same screen in the dark appearance — not a second
// implementation that could drift.
function ForgotPassword({ admin = false }) {
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        if (!email) return handleError('Email is required');

        setSubmitting(true);
        try {
            const response = await apiFetch('/recovery/forgotpassword', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const result = await response.json();
            if (result.success) {
                handleSuccess(result.message);
                setTimeout(() => navigate(admin ? '/admin/verifyotp' : '/verifyotp'), 800);
            } else {
                handleError(result.message);
            }
        } catch (err) {
            handleError('An error occurred');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout
            dark={admin}
            eyebrow={admin ? 'Admin portal' : null}
            title="Forgot your password?"
            subtitle={
                admin
                    ? "Enter your admin email and we'll send you a 4-digit code to reset your password."
                    : "Enter the email on your account and we'll send you a 4-digit code to reset it."
            }
            footer={
                <>
                    Remembered it?{' '}
                    <Link to={admin ? '/admin/login' : '/login'} className="link font-medium">
                        Back to sign in
                    </Link>
                </>
            }
        >
            <form onSubmit={handleForgotPassword}>
                <Field
                    id="email"
                    type="email"
                    label={admin ? 'Admin email' : 'Email'}
                    className={admin ? 'field-dark' : ''}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                    spellCheck="false"
                />

                <button
                    type="submit"
                    disabled={submitting}
                    className={`btn btn-lg btn-full mt-5 ${
                        admin ? '!bg-[#0a84ff] !text-white hover:!bg-[#3d9bff]' : 'btn-blue'
                    }`}
                >
                    {submitting ? 'Sending…' : 'Send code'}
                </button>

                {/* Deliberate non-disclosure: the server answers the same way
                    whether or not the address has an account. */}
                <p className={`text-cap text-center mt-4 leading-relaxed ${admin ? 'text-[#8e8e93]' : 'dim'}`}>
                    If an account exists for that address, the code is on its way.
                </p>
            </form>
        </AuthLayout>
    );
}

export default ForgotPassword;
