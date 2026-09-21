import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { handleError, handleSuccess, apiFetch } from '../utils';
import AuthLayout from './AuthLayout';
import PasswordStrengthHint from './PasswordStrengthHint';
import { Field } from './ui/Primitives';

// Same screen for both audiences — see ForgotPassword for why.
function ResetPassword({ admin = false }) {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    // Independent of the field above: revealing one to check a typo should
    // not expose the other.
    const [showConfirm, setShowConfirm] = useState(false);
    const navigate = useNavigate();

    const handleResetPassword = async (e) => {
        e.preventDefault();
        if (!password || !confirmPassword) return handleError('Both fields are required');
        if (password !== confirmPassword) return handleError('Passwords do not match');

        setSubmitting(true);
        try {
            const response = await apiFetch('/recovery/resetpassword', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const result = await response.json();
            if (result.success) {
                handleSuccess(result.message);
                setTimeout(() => navigate(admin ? '/admin/login' : '/login'), 800);
            } else {
                handleError(result.message);
            }
        } catch (err) {
            handleError('An error occurred');
        } finally {
            setSubmitting(false);
        }
    };

    const mismatch = confirmPassword !== '' && password !== confirmPassword;

    return (
        <AuthLayout
            dark={admin}
            eyebrow={admin ? 'Admin portal' : null}
            title="Set a new password"
            subtitle="Choose something strong and unique. You'll use this from now on."
            footer={
                <>
                    Changed your mind?{' '}
                    <Link to={admin ? '/admin/login' : '/login'} className="link font-medium">
                        Back to sign in
                    </Link>
                </>
            }
        >
            <form onSubmit={handleResetPassword} className="flex flex-col gap-3">
                <div>
                    <Field
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        label="New password"
                        className={admin ? 'field-dark' : ''}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoFocus
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
                    <PasswordStrengthHint password={password} />
                </div>

                <Field
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    label="Confirm new password"
                    className={admin ? 'field-dark' : ''}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    error={mismatch}
                    hint={mismatch ? 'Passwords do not match.' : undefined}
                    hintBad={mismatch}
                    trailing={
                        <button
                            type="button"
                            className="field-reveal"
                            onClick={() => setShowConfirm((v) => !v)}
                            aria-label={showConfirm ? 'Hide password' : 'Show password'}
                        >
                            {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    }
                />

                <button
                    type="submit"
                    disabled={submitting}
                    className={`btn btn-lg btn-full mt-2 ${
                        admin ? '!bg-[#0a84ff] !text-white hover:!bg-[#3d9bff]' : 'btn-blue'
                    }`}
                >
                    {submitting ? 'Updating…' : 'Update password'}
                </button>
            </form>
        </AuthLayout>
    );
}

export default ResetPassword;
