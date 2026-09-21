import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { handleError, handleSuccess, logoutAdmin, apiFetch, AUTH_SERVER_URL, CLIENT_URL } from '../utils';
import { Sheet, Field } from './ui/Primitives';

/**
 * Requesting a provider authorization, as a dialog over Auth management.
 *
 * This was a full page at /admin/auth/request. It is four fields and a
 * button, so it is a sheet now; the explanation of what the flow actually
 * does lives on the How it works page instead of crowding the form.
 *
 * The request, the validation and the redirect are unchanged.
 */
function AuthRequestSheet({ open, onClose }) {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        apiName: '',
        clientId: '',
        clientSecret: '',
        redirectUri: '',
    });

    useEffect(() => {
        if (open) {
            setFormData({ apiName: '', clientId: '', clientSecret: '', redirectUri: '' });
        }
    }, [open]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleLogout = async () => {
        await logoutAdmin();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/admin/login'), 800);
    };

    const handleAuthorize = async (e) => {
        e.preventDefault();
        const { apiName, clientId, clientSecret, redirectUri } = formData;
        if (!apiName || !clientId || !clientSecret || !redirectUri) {
            return handleError('All fields are required');
        }

        setSubmitting(true);
        try {
            const response = await apiFetch('/admin/client/details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (response.ok) {
                const callbackUrl = encodeURIComponent(
                    `${CLIENT_URL}/admin/client/callback?fromLogin=true`
                );
                window.location.href = `${AUTH_SERVER_URL}/auth/client/login?callbackUrl=${callbackUrl}&client_id=${encodeURIComponent(clientId)}`;
            } else {
                const errorData = await response.json();
                if (errorData.message && errorData.message.toLowerCase().includes('token has expired')) {
                    handleLogout();
                } else {
                    handleError(errorData.message || 'Authorization failed');
                }
            }
        } catch (err) {
            handleError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} labelledBy="auth-request-title" className="!max-w-[480px]">
            <form onSubmit={handleAuthorize}>
                <div className="flex items-center gap-3.5">
                    <span className="w-11 h-11 rounded-fld bg-haze grid place-items-center shrink-0">
                        <KeyRound size={19} aria-hidden="true" />
                    </span>
                    <h2 id="auth-request-title" className="t-h4 min-w-0">
                        Request API authorization
                    </h2>
                </div>

                {/* The four fields the live form posts to
                    /admin/client/details. No scope picker, no environment
                    switch, no expiry — none of those exist on the record. */}
                <div className="mt-6 pt-5 border-t border-hairlineSoft flex flex-col gap-3">
                    <Field
                        id="apiName"
                        name="apiName"
                        label="API name"
                        value={formData.apiName}
                        onChange={handleChange}
                        required
                        autoFocus
                        spellCheck="false"
                    />
                    <Field
                        id="clientId"
                        name="clientId"
                        label="Client ID"
                        value={formData.clientId}
                        onChange={handleChange}
                        required
                        spellCheck="false"
                    />
                    <Field
                        id="clientSecret"
                        name="clientSecret"
                        type="password"
                        label="Client secret"
                        value={formData.clientSecret}
                        onChange={handleChange}
                        required
                        autoComplete="off"
                    />
                    <Field
                        id="redirectUri"
                        name="redirectUri"
                        type="url"
                        label="Redirect URI"
                        value={formData.redirectUri}
                        onChange={handleChange}
                        required
                        spellCheck="false"
                    />
                </div>

                <div className="mt-6 flex gap-2.5">
                    <button type="button" onClick={onClose} className="btn btn-quiet btn-lg flex-1">
                        Cancel
                    </button>
                    <button type="submit" disabled={submitting} className="btn btn-blue btn-lg flex-1">
                        {submitting ? 'Authorizing…' : 'Authorize'}
                    </button>
                </div>
            </form>
        </Sheet>
    );
}

export default AuthRequestSheet;
