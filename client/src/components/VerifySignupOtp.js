import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { handleError, handleSuccess, apiFetch } from '../utils';
import AuthLayout from './AuthLayout';
import { Passcode } from './ui/Primitives';

function VerifySignupOtp() {
    const [otp, setOtp] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (otp.length !== 4) return handleError('Please enter a 4-digit OTP');

        setSubmitting(true);
        try {
            const response = await apiFetch('/auth/signup/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp }),
            });
            const result = await response.json();
            if (result.success) {
                handleSuccess(result.message);
                setTimeout(() => navigate('/home'), 800);
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
            title="Verify your email"
            subtitle="We sent a 4-digit code to your email. Enter it below to finish creating your account."
            footer={
                <>
                    Wrong email?{' '}
                    <Link to="/signup" className="link font-medium">Start over</Link>
                </>
            }
        >
            <form onSubmit={handleVerifyOtp}>
                {/* Four boxes over the one `otp` string this page already
                    kept in state — nothing about the request changed. */}
                <Passcode value={otp} onChange={setOtp} autoFocus ariaLabel="4-digit code" />

                {/* Deliberately not disabled on a short code — submitting
                    one still raises "Please enter a 4-digit OTP", which is
                    the feedback this page has always given. */}
                <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-blue btn-lg btn-full mt-7"
                >
                    {submitting ? 'Verifying…' : 'Verify and continue'}
                </button>

                <p className="text-cap dim text-center mt-4 leading-relaxed">
                    Nothing is saved to your account until this code is verified.
                </p>
            </form>
        </AuthLayout>
    );
}

export default VerifySignupOtp;
