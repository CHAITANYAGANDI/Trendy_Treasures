import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import { handleSuccess, logoutAdmin, apiFetch, isStrongPassword, STRONG_PASSWORD_MESSAGE } from '../utils';
import FormErrorBanner from './FormErrorBanner';
import PasswordStrengthHint from './PasswordStrengthHint';
import { Sheet, Field } from './ui/Primitives';

/**
 * Creating an admin, as a dialog over User management.
 *
 * This was a full page at /admin/register reached from the sidebar. It is
 * one three-field form whose result belongs on the list you were already
 * looking at, so it is a sheet now and `onCreated` refreshes that list in
 * place. The request, the validation and the error handling are unchanged.
 */
function AddAdminSheet({ open, onClose, onCreated }) {
    const [formData, setFormData] = useState({ name: '', adminId: '', password: '' });
    const [errorBanner, setErrorBanner] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    // Start clean every time it opens — a half-typed admin from last time
    // is never what you want to see.
    useEffect(() => {
        if (open) {
            setFormData({ name: '', adminId: '', password: '' });
            setErrorBanner('');
            setShowPassword(false);
        }
    }, [open]);

    const handleLogout = async () => {
        await logoutAdmin();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/admin/login'), 800);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        if (errorBanner) setErrorBanner('');
    };

    const showWeakPasswordError = () => {
        setErrorBanner(STRONG_PASSWORD_MESSAGE);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { name, adminId, password } = formData;
        if (!name || !adminId || !password) return setErrorBanner('All fields are required');
        if (!isStrongPassword(password)) return showWeakPasswordError();

        setSubmitting(true);
        setErrorBanner('');
        try {
            const response = await apiFetch('/admin/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const result = await response.json().catch(() => ({}));
            const { success, message, error } = result;
            if (response.ok && success) {
                handleSuccess(message);
                // Stay on User management and show the new row rather than
                // navigating away from the list that just changed.
                onCreated && onCreated();
                onClose();
            } else if (error) {
                const detailMessage = error?.details?.[0]?.message;
                if (detailMessage === STRONG_PASSWORD_MESSAGE || error?.details?.[0]?.path?.[0] === 'password') {
                    showWeakPasswordError();
                    return;
                }
                setErrorBanner(detailMessage || 'Admin registration failed');
            } else {
                if (message && message.toLowerCase().includes('token has expired')) {
                    handleLogout();
                    return;
                }
                setErrorBanner(message || 'Admin registration failed. Please try again.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} labelledBy="add-admin-title" className="!max-w-[460px]">
            <form onSubmit={handleSubmit}>
                <div className="flex items-center gap-3.5">
                    <span className="w-11 h-11 rounded-fld bg-haze grid place-items-center shrink-0">
                        <UserPlus size={19} aria-hidden="true" />
                    </span>
                    <h2 id="add-admin-title" className="t-h4 min-w-0">Add an admin</h2>
                </div>

                <div className="mt-6 pt-5 border-t border-hairlineSoft flex flex-col gap-3">
                    {errorBanner && <FormErrorBanner message={errorBanner} />}

                    <Field
                        id="admin-name"
                        name="name"
                        label="Name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        autoFocus
                        autoComplete="name"
                    />
                    {/* Still posted as `adminId` — that is the field name the
                        register endpoint expects. It lands in the unique
                        `email` column, shared with customer accounts. */}
                    <Field
                        id="admin-email"
                        name="adminId"
                        type="email"
                        label="Admin email"
                        value={formData.adminId}
                        onChange={handleChange}
                        required
                        autoComplete="off"
                        spellCheck="false"
                    />
                    <div>
                        <Field
                            id="admin-password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            label="Password"
                            value={formData.password}
                            onChange={handleChange}
                            required
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
                        <PasswordStrengthHint password={formData.password} />
                    </div>
                </div>

                <div className="mt-6 flex gap-2.5">
                    <button type="button" onClick={onClose} className="btn btn-quiet btn-lg flex-1">
                        Cancel
                    </button>
                    <button type="submit" disabled={submitting} className="btn btn-blue btn-lg flex-1">
                        {submitting ? 'Creating…' : 'Add admin'}
                    </button>
                </div>
            </form>
        </Sheet>
    );
}

export default AddAdminSheet;
