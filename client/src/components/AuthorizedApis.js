import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, AlertTriangle, Trash2, Eye, EyeOff } from 'lucide-react';
import { handleSuccess, handleError, logoutAdmin, apiFetch, showConfirm } from '../utils';
import { Spinner } from './ui/Primitives';

// Hidden tokens are all dots, and always the same number of them — showing
// the first/last characters (or the whole thing when short) leaked part of
// a live provider token, and a per-character mask leaks its length.
const TOKEN_MASK = '•'.repeat(16);

/**
 * The stored provider credentials, as a section of Auth management.
 *
 * This was its own page at /admin/auth/protected reached from the sidebar.
 * It is now the whole body of Auth management: requesting a connection is a
 * dialog over it, and the explanation of the flow lives on How it works.
 * Every control, message and state is the same as the standalone page had.
 */
function AuthorizedApis({ onRequest }) {
    const [credentials, setCredentials] = useState([]);
    const [loading, setLoading] = useState(true);
    const [revealed, setRevealed] = useState({});
    const [deletingId, setDeletingId] = useState(null);
    const navigate = useNavigate();

    const handleLogout = useCallback(async () => {
        await logoutAdmin();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/admin/login'), 800);
    }, [navigate]);

    const fetchCredentials = useCallback(async () => {
        setLoading(true);
        try {
            const response = await apiFetch('/admin/client/creds');
            if (response.ok) {
                const responseData = await response.json();
                setCredentials(responseData.data || []);
            } else {
                const errorData = await response.json().catch(() => ({}));
                if (errorData.message && errorData.message.toLowerCase().includes('token has expired')) {
                    handleLogout();
                }
                console.error('Failed to fetch credentials:', errorData.message);
            }
        } catch (error) {
            console.error('Error fetching credentials:', error);
        } finally {
            setLoading(false);
        }
    }, [handleLogout]);

    useEffect(() => {
        fetchCredentials();
    }, [fetchCredentials]);

    const copyToken = async (token) => {
        try {
            await navigator.clipboard.writeText(token);
            handleSuccess('Token copied to clipboard');
        } catch {
            handleError('Could not copy to clipboard');
        }
    };

    const deleteCredential = async (credential) => {
        const ok = await showConfirm({
            title: 'Delete this authorized API?',
            body: `${credential.api_name || 'This API'} will be disconnected and the gateway will no longer have its stored access token.`,
            confirmLabel: 'Delete API',
            cancelLabel: 'Cancel',
            danger: true
        });
        if (!ok) return;

        setDeletingId(credential._id);
        try {
            const response = await apiFetch(`/admin/client/creds/${credential._id}`, {
                method: 'DELETE'
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                handleSuccess(result.message || 'Authorized API deleted');
                setCredentials((prev) => prev.filter((item) => item._id !== credential._id));
                setRevealed((prev) => {
                    const next = { ...prev };
                    delete next[credential._id];
                    return next;
                });
            } else {
                handleError(result.message || 'Failed to delete authorized API');
            }
        } catch (error) {
            handleError(error.message);
        } finally {
            setDeletingId(null);
        }
    };

    const maskToken = (token) => (token ? TOKEN_MASK : '—');

    return (
        <section aria-labelledby="authorized-apis-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 id="authorized-apis-title" className="t-h3">Authorized APIs</h2>
                    <p className="t-ui dim mt-1">
                        {loading
                            ? 'Loading…'
                            : `${credentials.length} connection${credentials.length === 1 ? '' : 's'} configured`}
                    </p>
                </div>
                {/* No action button here — the page's own title bar already
                    carries "Request API authorization". */}
            </div>

            <div className="mt-5">
                {loading ? (
                    <div className="py-14 flex flex-col items-center gap-3" role="status">
                        <Spinner size={24} />
                        <p className="t-ui dim">Loading credentials…</p>
                    </div>
                ) : credentials.length === 0 ? (
                    /* The empty state of a security surface has to answer the
                       admin's real question: is the storefront broken right now? */
                    <div className="border-t border-hairline min-h-[360px] py-12 flex flex-col items-center justify-center text-center">
                        <span className="w-14 h-14 rounded-full bg-amberWash grid place-items-center">
                            <AlertTriangle size={24} className="text-amber" aria-hidden="true" />
                        </span>
                        <h3 className="t-h4 mt-5">No API authorizations yet</h3>
                        <p className="t-ui dim mt-2 leading-relaxed max-w-[460px]">
                            Connect a store to start showing its products. Until then
                            the shop has nothing to list &mdash; shoppers see
                            &ldquo;We could not load products&rdquo; &mdash; and price
                            alerts stop being checked.
                        </p>
                        <button
                            type="button"
                            onClick={onRequest}
                            className="btn btn-blue mt-6"
                        >
                            Request authorization
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="tablewrap">
                            {/* The Credential record holds client_id, api_name, api_url
                                and access_token. Status is a plain "Active" because no
                                expiry is stored — a countdown would be invented. */}
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="center">API name</th>
                                        <th className="center">API URL</th>
                                        <th className="center">Access token</th>
                                        <th className="center">Status</th>
                                        <th className="center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {credentials.map((credential) => (
                                        <tr key={credential._id}>
                                            <td className="center font-medium">{credential.api_name}</td>
                                            <td className="center">
                                                <code className="mono dim">{credential.api_url}</code>
                                            </td>
                                            <td className="center">
                                                <span className="token">
                                                    <code>
                                                        {revealed[credential._id]
                                                            ? credential.access_token
                                                            : maskToken(credential.access_token)}
                                                    </code>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setRevealed((p) => ({
                                                                ...p,
                                                                [credential._id]: !p[credential._id]
                                                            }))
                                                        }
                                                        className="icon-btn"
                                                        aria-label={`${revealed[credential._id] ? 'Hide' : 'Show'} ${credential.api_name} token`}
                                                        aria-pressed={Boolean(revealed[credential._id])}
                                                    >
                                                        {revealed[credential._id] ? (
                                                            <EyeOff size={15} aria-hidden="true" />
                                                        ) : (
                                                            <Eye size={15} aria-hidden="true" />
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => copyToken(credential.access_token)}
                                                        className="icon-btn"
                                                        aria-label={`Copy ${credential.api_name} token`}
                                                    >
                                                        <Copy size={15} aria-hidden="true" />
                                                    </button>
                                                </span>
                                            </td>
                                            <td className="center">
                                                <span className="status status-ok">Active</span>
                                            </td>
                                            <td className="center">
                                                <button
                                                    type="button"
                                                    onClick={() => deleteCredential(credential)}
                                                    disabled={deletingId === credential._id}
                                                    className="icon-btn icon-btn-danger"
                                                    title="Delete authorized API"
                                                    aria-label={`Delete ${credential.api_name || 'authorized API'}`}
                                                >
                                                    <Trash2 size={16} aria-hidden="true" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                    </>
                )}
            </div>
        </section>
    );
}

export default AuthorizedApis;
