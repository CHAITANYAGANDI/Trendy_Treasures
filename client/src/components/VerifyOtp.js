import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { handleError, handleSuccess, apiFetch } from '../utils';
import AuthLayout from './AuthLayout';
import { Passcode } from './ui/Primitives';

// Same screen for both audiences — see ForgotPassword for why.
function VerifyOtp({ admin = false }) {
    const [otp, setOtp] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (otp.length !== 4) return handleError('Please enter a 4-digit OTP');

        setSubmitting(true);
        try {
            const response = await apiFetch('/recovery/verifyotp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp }),
            });
            const result = await response.json();
            if (result.success) {
                handleSuccess(result.message);
                setTimeout(() => navigate(admin ? '/admin/resetpassword' : '/resetpassword'), 800);
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
            title="Enter your code"
            subtitle="Check your inbox — we sent a 4-digit code. Enter it below to continue."
            footer={
                <>
                    Didn't get a code?{' '}
                    <Link to={admin ? '/admin/forgot' : '/forgotpassword'} className="link font-medium">
                        Send a new one
                    </Link>
                </>
            }
        >
            <form onSubmit={handleVerifyOtp}>
                <Passcode value={otp} onChange={setOtp} autoFocus ariaLabel="4-digit code" />

                <button
                    type="submit"
                    disabled={submitting}
                    className={`btn btn-lg btn-full mt-7 ${
                        admin ? '!bg-[#0a84ff] !text-white hover:!bg-[#3d9bff]' : 'btn-blue'
                    }`}
                >
                    {submitting ? 'Verifying…' : 'Verify code'}
                </button>

                <p className={`text-cap text-center mt-4 leading-relaxed ${admin ? 'text-[#8e8e93]' : 'dim'}`}>
                    The code expires after a few minutes. Check your spam folder if it
                    has not arrived.
                </p>
            </form>
        </AuthLayout>
    );
}

export default VerifyOtp;
