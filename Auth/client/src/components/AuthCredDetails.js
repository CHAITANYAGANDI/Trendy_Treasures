import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    handleError,
    handleSuccess,
    logoutClient,
    authFetch,
    fetchCurrentClient
} from '../utils';
import MaskedSecret from './MaskedSecret';

const ACCENT = '#426fe7';
const BG = '#11131b';
const SURFACE = '#1d1f27';
const SURFACE_LOW = '#191b23';
const SURFACE_HIGH = '#282a32';
const SURFACE_BRIGHT = '#373941';
const SURFACE_LOWEST = '#0c0e15';
const BORDER = '#33343d';
const BORDER_DIM = '#434654';
const TEXT = '#e2e1ed';
const TEXT_MUTED = '#c3c6d6';
const TEXT_DIM = '#8d909f';
const ERROR = '#ffb4ab';

const ROTATION_THRESHOLD_DAYS = 90;

const daysSince = (d) => {
    if (!d) return Infinity;
    return (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
};

const getStatus = (creationDate) => {
    if (daysSince(creationDate) >= ROTATION_THRESHOLD_DAYS) {
        return { label: 'Pending Rotation', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' };
    }
    return { label: 'Active', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
};

const formatDate = (d) => {
    if (!d) return '';
    try {
        return new Date(d).toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        });
    } catch {
        return '';
    }
};

function CredentialDetails() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [credential, setCredential] = useState(null);
    const [loading, setLoading] = useState(true);
    const [rotating, setRotating] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showRotateModal, setShowRotateModal] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    // Plaintext shown only once after a successful Rotate.
    const [revealedSecret, setRevealedSecret] = useState(null);
    const [clientName, setClientName] = useState('');

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
        body.style.background = BG;
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

    useEffect(() => {
        const fetchCredentialDetails = async () => {
            try {
                const response = await authFetch(`/creds/apiinfo/${id}`, {
                    headers: { 'Content-Type': 'application/json' }
                });
                const result = await response.json();
                if (result.success) {
                    setCredential(result.credential);
                } else {
                    handleError(result.message || 'Failed to fetch credential details.');
                }
            } catch (err) {
                handleError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchCredentialDetails();
        fetchCurrentClient().then((c) => {
            if (c && (c.name || c.username)) {
                setClientName(c.name || c.username);
            }
        });
    }, [id]);

    const handleLogout = async () => {
        await logoutClient();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/auth/login'), 800);
    };

    const handleBack = () => navigate('/auth/dashboard');

    const copyToClipboard = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            handleSuccess(`${label} copied to clipboard`);
        } catch {
            handleError(`Could not copy ${label}`);
        }
    };

    const handleRotateSecret = () => setShowRotateModal(true);

    const confirmRotateSecret = async () => {
        setRotating(true);
        try {
            const response = await authFetch(`/credentials/${id}/rotate-secret`, {
                method: 'POST'
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                setShowRotateModal(false);
                // Plaintext is shown ONCE in a reveal modal; we don't store it
                // on the credential, since the server only persists the hash.
                setRevealedSecret(result.client_secret);
                handleSuccess('Secret rotated. Update your clients.');
            } else {
                handleError(result.message || 'Could not rotate secret');
            }
        } catch (err) {
            handleError(err.message);
        } finally {
            setRotating(false);
        }
    };

    const handleDelete = () => setShowDeleteModal(true);

    const confirmDelete = async () => {
        setDeleting(true);
        try {
            const response = await authFetch(`/credentials/${id}`, { method: 'DELETE' });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                handleSuccess('Credential deleted');
                setTimeout(() => navigate('/auth/dashboard'), 400);
            } else {
                setDeleting(false);
                handleError(result.message || 'Could not delete credential');
            }
        } catch (err) {
            setDeleting(false);
            handleError(err.message);
        }
    };

    return (
        <div
            className="font-body antialiased min-h-screen w-full flex flex-col"
            style={{ background: BG, color: TEXT }}
        >
            <header
                className="w-full h-16"
                style={{ background: SURFACE_LOWEST, borderBottom: `1px solid ${BORDER}` }}
            >
                <div className="flex items-center justify-between px-4 md:px-12 w-full h-full">
                    <div
                        className="flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                        onClick={() => navigate('/auth/dashboard')}
                    >
                        <span
                            className="material-symbols-outlined fill text-3xl"
                            style={{ color: ACCENT }}
                        >
                            shield
                        </span>
                        <span className="font-headline font-bold text-2xl" style={{ color: TEXT }}>
                            AuthShield
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/auth/settings')}
                            className="hidden md:flex items-center justify-center p-2 rounded-full transition-colors focus:outline-none bg-transparent border-0 cursor-pointer"
                            style={{ color: TEXT_MUTED }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = SURFACE_HIGH;
                                e.currentTarget.style.color = ACCENT;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = TEXT_MUTED;
                            }}
                            aria-label="Settings"
                        >
                            <span className="material-symbols-outlined">settings</span>
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setAccountOpen((v) => !v)}
                                className="flex items-center justify-center p-2 rounded-full transition-colors focus:outline-none bg-transparent border-0 cursor-pointer"
                                style={{ color: TEXT_MUTED }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = SURFACE_HIGH;
                                    e.currentTarget.style.color = ACCENT;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = TEXT_MUTED;
                                }}
                                aria-label="Account"
                            >
                                <span className="material-symbols-outlined">account_circle</span>
                            </button>
                            {accountOpen && (
                                <div
                                    className="absolute right-0 mt-2 w-48 rounded-lg shadow-lg py-1 z-50"
                                    style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
                                >
                                    {clientName && (
                                        <div
                                            className="px-4 py-2 text-xs uppercase tracking-wider text-left"
                                            style={{
                                                color: TEXT_DIM,
                                                borderBottom: `1px solid ${BORDER}`
                                            }}
                                        >
                                            {clientName}
                                        </div>
                                    )}
                                    <button
                                        onClick={handleLogout}
                                        className="flex w-full items-center gap-2 text-left px-4 py-2 text-sm transition-colors bg-transparent border-0 cursor-pointer"
                                        style={{ color: TEXT }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
                                            e.currentTarget.style.color = '#ef4444';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.color = TEXT;
                                        }}
                                    >
                                        <span className="material-symbols-outlined text-base">logout</span>
                                        Logout
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-grow w-full px-4 md:px-12 py-8 md:py-12">
                <div className="mb-8 text-left">
                    <button
                        onClick={handleBack}
                        className="inline-flex items-center gap-2 mb-4 pl-0 ml-0 transition-colors uppercase tracking-widest text-xs font-medium bg-transparent border-0 cursor-pointer self-start"
                        style={{ color: TEXT_MUTED }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = ACCENT)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_MUTED)}
                    >
                        <span className="material-symbols-outlined text-lg">arrow_back</span>
                        Back to dashboard
                    </button>
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                        <div>
                            {credential?.api_name && (
                                <h1
                                    className="font-headline font-semibold text-2xl"
                                    style={{ color: TEXT }}
                                >
                                    {credential.api_name}
                                </h1>
                            )}
                        </div>
                        {credential?.creation_date && (() => {
                            const status = getStatus(credential.creation_date);
                            return (
                                <div className="flex items-center gap-3">
                                    <span
                                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                                        style={{ background: status.bg, color: status.color }}
                                    >
                                        {status.label}
                                    </span>
                                    <span className="text-sm" style={{ color: TEXT_DIM }}>
                                        Created {formatDate(credential.creation_date)}
                                    </span>
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {loading ? (
                    <div
                        className="rounded-xl p-12 text-center"
                        style={{ background: SURFACE, color: TEXT_MUTED, border: `1px solid ${BORDER}` }}
                    >
                        Loading credential…
                    </div>
                ) : !credential ? (
                    <div
                        className="rounded-xl p-12 text-center"
                        style={{ background: SURFACE, color: TEXT_MUTED, border: `1px solid ${BORDER}` }}
                    >
                        <p className="mb-4">No credential details found.</p>
                        <button
                            onClick={handleBack}
                            className="px-4 py-2 rounded text-sm font-medium border-0 cursor-pointer"
                            style={{ background: ACCENT, color: '#fff' }}
                        >
                            Back to Dashboard
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-8 flex flex-col gap-6">
                            <DetailCard
                                title="Client ID"
                                actions={
                                    <PillButton
                                        icon="content_copy"
                                        onClick={() => copyToClipboard(credential.client_id, 'Client ID')}
                                    >
                                        Copy
                                    </PillButton>
                                }
                            >
                                <CodeBlock>{credential.client_id}</CodeBlock>
                                <p className="text-xs mt-3" style={{ color: TEXT_DIM }}>
                                    The public identifier for your application. Safe to include in client-side
                                    code if necessary.
                                </p>
                            </DetailCard>

                            <DetailCard title="Client Secret">
                                <div
                                    className="flex items-start gap-3 p-4 rounded-lg"
                                    style={{
                                        background: BG,
                                        border: `1px solid ${BORDER}`
                                    }}
                                >
                                    <span
                                        className="material-symbols-outlined text-xl mt-0.5"
                                        style={{ color: TEXT_DIM }}
                                    >
                                        lock
                                    </span>
                                    <div>
                                        <p className="text-sm font-medium" style={{ color: TEXT }}>
                                            Client secret is hidden for security.
                                        </p>
                                        <p className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
                                            We only stored a hash of the secret. To get a fresh
                                            plaintext value, rotate the secret below — you'll see
                                            it once.
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 flex gap-3">
                                    <button
                                        onClick={handleRotateSecret}
                                        disabled={rotating}
                                        className="text-xs font-medium px-4 py-2 rounded transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                                        style={{
                                            background: SURFACE_BRIGHT,
                                            color: TEXT,
                                            border: `1px solid ${BORDER_DIM}`
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!rotating) e.currentTarget.style.background = '#3f414b';
                                        }}
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.background = SURFACE_BRIGHT)
                                        }
                                    >
                                        <span className="material-symbols-outlined text-base">
                                            autorenew
                                        </span>
                                        {rotating ? 'Rotating…' : 'Rotate Secret'}
                                    </button>
                                </div>
                            </DetailCard>

                            <div
                                className="rounded-xl overflow-hidden"
                                style={{
                                    background: SURFACE_LOW,
                                    border: `1px solid rgba(255, 180, 171, 0.25)`
                                }}
                            >
                                <div
                                    className="p-6"
                                    style={{ borderBottom: '1px solid rgba(255, 180, 171, 0.15)' }}
                                >
                                    <h2
                                        className="uppercase tracking-widest text-xs font-medium flex items-center gap-2"
                                        style={{ color: ERROR }}
                                    >
                                        <span className="material-symbols-outlined text-lg">warning</span>
                                        Delete Credential
                                    </h2>
                                </div>
                                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="max-w-md">
                                        <p className="text-sm" style={{ color: TEXT_MUTED }}>
                                            Permanently delete this credential and all associated access. This
                                            action cannot be undone.
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="flex-shrink-0 text-xs font-medium px-4 py-2 rounded transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                        style={{ background: ERROR, color: '#690005', border: 'none' }}
                                        onMouseEnter={(e) => {
                                            if (!deleting) e.currentTarget.style.opacity = '0.9';
                                        }}
                                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                    >
                                        <span className="material-symbols-outlined text-lg">delete</span>
                                        {deleting ? 'Deleting…' : 'Delete Credential'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-4 flex flex-col gap-6">
                            <div
                                className="rounded-xl h-full"
                                style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
                            >
                                <div className="p-6" style={{ borderBottom: `1px solid ${BORDER}` }}>
                                    <h2
                                        className="uppercase tracking-widest text-xs font-medium"
                                        style={{ color: TEXT }}
                                    >
                                        Environment Config
                                    </h2>
                                </div>
                                <div className="p-6 flex flex-col gap-6">
                                    <div>
                                        <label
                                            className="block text-xs uppercase tracking-wider font-medium mb-2"
                                            style={{ color: TEXT_MUTED }}
                                        >
                                            Base API URL
                                        </label>
                                        <div
                                            className="p-3 rounded-lg break-all flex justify-between items-center gap-3 group font-mono text-xs"
                                            style={{
                                                background: SURFACE_LOWEST,
                                                color: TEXT,
                                                border: `1px solid ${BORDER}`
                                            }}
                                        >
                                            <span>{credential.api_url}</span>
                                            <button
                                                onClick={() => copyToClipboard(credential.api_url, 'API URL')}
                                                className="bg-transparent border-0 cursor-pointer flex-shrink-0"
                                                style={{ color: TEXT_DIM }}
                                                onMouseEnter={(e) => (e.currentTarget.style.color = ACCENT)}
                                                onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_DIM)}
                                                aria-label="Copy API URL"
                                            >
                                                <span className="material-symbols-outlined text-base">
                                                    content_copy
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label
                                            className="block text-xs uppercase tracking-wider font-medium mb-2"
                                            style={{ color: TEXT_MUTED }}
                                        >
                                            Redirect URI
                                        </label>
                                        <div
                                            className="rounded-lg overflow-hidden"
                                            style={{
                                                background: SURFACE_LOWEST,
                                                border: `1px solid ${BORDER}`
                                            }}
                                        >
                                            <div
                                                className="p-3 break-all flex justify-between items-center gap-3 font-mono text-xs"
                                                style={{ color: TEXT }}
                                            >
                                                <span>{credential.redirect_uri}</span>
                                                <button
                                                    onClick={() =>
                                                        copyToClipboard(
                                                            credential.redirect_uri,
                                                            'Redirect URI'
                                                        )
                                                    }
                                                    className="bg-transparent border-0 cursor-pointer flex-shrink-0"
                                                    style={{ color: TEXT_DIM }}
                                                    onMouseEnter={(e) =>
                                                        (e.currentTarget.style.color = ACCENT)
                                                    }
                                                    onMouseLeave={(e) =>
                                                        (e.currentTarget.style.color = TEXT_DIM)
                                                    }
                                                    aria-label="Copy Redirect URI"
                                                >
                                                    <span className="material-symbols-outlined text-base">
                                                        content_copy
                                                    </span>
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-xs mt-2" style={{ color: TEXT_DIM }}>
                                            Where users will be redirected after successful authentication.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {showDeleteModal && (
                <DeleteCredentialModal
                    credential={credential}
                    onClose={() => !deleting && setShowDeleteModal(false)}
                    onConfirm={confirmDelete}
                    deleting={deleting}
                />
            )}

            {showRotateModal && (
                <RotateSecretModal
                    credential={credential}
                    onClose={() => !rotating && setShowRotateModal(false)}
                    onConfirm={confirmRotateSecret}
                    rotating={rotating}
                />
            )}

            {revealedSecret && (
                <RevealSecretModal
                    secret={revealedSecret}
                    onClose={() => setRevealedSecret(null)}
                />
            )}
        </div>
    );
}

function RotateSecretModal({ credential, onClose, onConfirm, rotating }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && !rotating) onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose, rotating]);

    const ROTATE = '#f59e0b';

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{
                background: 'rgba(11, 13, 27, 0.55)',
                backdropFilter: 'blur(14px) saturate(160%)',
                WebkitBackdropFilter: 'blur(14px) saturate(160%)'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !rotating) onClose();
            }}
        >
            <div
                className="relative w-full max-w-md rounded-2xl overflow-hidden"
                style={{
                    background: 'rgba(29, 31, 39, 0.78)',
                    backdropFilter: 'blur(28px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow:
                        '0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
                }}
            >
                <button
                    onClick={onClose}
                    disabled={rotating}
                    aria-label="Close"
                    className="absolute top-4 right-4 p-2 rounded-full transition-colors focus:outline-none z-10 bg-transparent border-0 cursor-pointer disabled:opacity-50"
                    style={{ color: TEXT_MUTED }}
                    onMouseEnter={(e) => {
                        if (rotating) return;
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                        e.currentTarget.style.color = TEXT;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = TEXT_MUTED;
                    }}
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <div className="p-8 sm:p-10">
                    <div
                        className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                        style={{ background: 'rgba(245,158,11,0.12)', color: ROTATE }}
                    >
                        <span className="material-symbols-outlined text-3xl">autorenew</span>
                    </div>
                    <h2 className="font-headline font-bold text-2xl mb-3" style={{ color: TEXT }}>
                        Rotate client secret
                    </h2>
                    <p className="text-sm mb-4" style={{ color: TEXT_MUTED }}>
                        A new client secret will be generated for
                        {credential?.api_name ? (
                            <>
                                {' '}
                                <span style={{ color: TEXT, fontWeight: 600 }}>
                                    {credential.api_name}
                                </span>
                            </>
                        ) : (
                            ' this credential'
                        )}
                        . The previous secret will stop working immediately, and any clients
                        still using it will fail to authenticate.
                    </p>
                    <p className="text-sm mb-8" style={{ color: TEXT }}>
                        Do you want to rotate the secret now?
                    </p>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={rotating}
                            className="text-sm font-medium px-5 py-2.5 rounded transition-colors bg-transparent cursor-pointer disabled:opacity-50"
                            style={{ color: TEXT_MUTED, border: `1px solid ${BORDER}` }}
                            onMouseEnter={(e) => {
                                if (rotating) return;
                                e.currentTarget.style.color = TEXT;
                                e.currentTarget.style.borderColor = TEXT_DIM;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = TEXT_MUTED;
                                e.currentTarget.style.borderColor = BORDER;
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={rotating}
                            className="text-sm font-semibold px-5 py-2.5 rounded transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ background: ROTATE, color: '#1c1300', border: 'none' }}
                            onMouseEnter={(e) => {
                                if (!rotating) e.currentTarget.style.opacity = '0.9';
                            }}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                            <span className="material-symbols-outlined text-base">autorenew</span>
                            {rotating ? 'Rotating…' : 'Rotate Secret'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RevealSecretModal({ secret, onClose }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(secret);
            handleSuccess('Client Secret copied to clipboard');
        } catch {
            handleError('Could not copy Client Secret');
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{
                background: 'rgba(11, 13, 27, 0.55)',
                backdropFilter: 'blur(14px) saturate(160%)',
                WebkitBackdropFilter: 'blur(14px) saturate(160%)'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="relative w-full max-w-xl rounded-2xl overflow-hidden"
                style={{
                    background: 'rgba(29, 31, 39, 0.78)',
                    backdropFilter: 'blur(28px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow:
                        '0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
                }}
            >
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute top-4 right-4 p-2 rounded-full transition-colors focus:outline-none z-10 bg-transparent border-0 cursor-pointer"
                    style={{ color: TEXT_MUTED }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                        e.currentTarget.style.color = TEXT;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = TEXT_MUTED;
                    }}
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <div className="p-8 sm:p-10">
                    <div
                        className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                        style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
                    >
                        <span className="material-symbols-outlined text-3xl">check_circle</span>
                    </div>
                    <h2 className="font-headline font-bold text-2xl mb-2" style={{ color: TEXT }}>
                        Secret rotated
                    </h2>
                    <p className="text-sm mb-6" style={{ color: TEXT_MUTED }}>
                        This is the only time we'll show your new client secret. Save it
                        somewhere safe — if you lose it you'll need to rotate again.
                    </p>

                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <label
                                className="text-xs uppercase tracking-wider font-medium"
                                style={{ color: '#fca5a5' }}
                            >
                                Client Secret
                            </label>
                            <button
                                type="button"
                                onClick={copy}
                                className="text-xs font-medium flex items-center gap-1 bg-transparent border-0 cursor-pointer"
                                style={{ color: ACCENT }}
                            >
                                <span className="material-symbols-outlined text-sm">content_copy</span>
                                Copy
                            </button>
                        </div>
                        <MaskedSecret
                            value={secret}
                            label="Client Secret"
                            style={{
                                background: BG,
                                color: TEXT,
                                border: '1px solid rgba(239,68,68,0.4)'
                            }}
                        />
                    </div>

                    <div
                        className="pt-6 flex justify-end"
                        style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-sm font-semibold px-6 py-2.5 rounded transition-all cursor-pointer"
                            style={{ background: ACCENT, color: '#ffffff', border: 'none' }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                            I've saved it — done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DeleteCredentialModal({ credential, onClose, onConfirm, deleting }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && !deleting) onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose, deleting]);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{
                background: 'rgba(11, 13, 27, 0.55)',
                backdropFilter: 'blur(14px) saturate(160%)',
                WebkitBackdropFilter: 'blur(14px) saturate(160%)'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !deleting) onClose();
            }}
        >
            <div
                className="relative w-full max-w-md rounded-2xl overflow-hidden"
                style={{
                    background: 'rgba(29, 31, 39, 0.78)',
                    backdropFilter: 'blur(28px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow:
                        '0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
                }}
            >
                <button
                    onClick={onClose}
                    disabled={deleting}
                    aria-label="Close"
                    className="absolute top-4 right-4 p-2 rounded-full transition-colors focus:outline-none z-10 bg-transparent border-0 cursor-pointer disabled:opacity-50"
                    style={{ color: TEXT_MUTED }}
                    onMouseEnter={(e) => {
                        if (deleting) return;
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                        e.currentTarget.style.color = TEXT;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = TEXT_MUTED;
                    }}
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <div className="p-8 sm:p-10">
                    <h2 className="font-headline font-bold text-2xl mb-3" style={{ color: TEXT }}>
                        Delete credential
                    </h2>
                    <p className="text-sm mb-4" style={{ color: TEXT_MUTED }}>
                        This credential will be deleted immediately. Once deleted, it can no longer be used
                        to make API requests
                        {credential?.api_name ? (
                            <>
                                {' '}for{' '}
                                <span style={{ color: TEXT, fontWeight: 600 }}>
                                    {credential.api_name}
                                </span>
                            </>
                        ) : null}
                        .
                    </p>
                    <p className="text-sm mb-8" style={{ color: TEXT }}>
                        Do you want to delete this credential?
                    </p>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={deleting}
                            className="text-sm font-medium px-5 py-2.5 rounded transition-colors bg-transparent cursor-pointer disabled:opacity-50"
                            style={{ color: TEXT_MUTED, border: `1px solid ${BORDER}` }}
                            onMouseEnter={(e) => {
                                if (deleting) return;
                                e.currentTarget.style.color = TEXT;
                                e.currentTarget.style.borderColor = TEXT_DIM;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = TEXT_MUTED;
                                e.currentTarget.style.borderColor = BORDER;
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={deleting}
                            className="text-sm font-semibold px-5 py-2.5 rounded transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ background: '#ef4444', color: '#ffffff', border: 'none' }}
                            onMouseEnter={(e) => {
                                if (!deleting) e.currentTarget.style.opacity = '0.9';
                            }}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                            {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DetailCard({ title, actions, children }) {
    return (
        <div
            className="rounded-xl transition-colors"
            style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
        >
            <div
                className="p-6 flex justify-between items-center gap-4"
                style={{ borderBottom: `1px solid ${BORDER}` }}
            >
                <h2
                    className="uppercase tracking-widest text-xs font-medium"
                    style={{ color: TEXT }}
                >
                    {title}
                </h2>
                {actions}
            </div>
            <div className="p-6" style={{ background: 'rgba(12, 14, 21, 0.4)', borderRadius: '0 0 0.5rem 0.5rem' }}>
                {children}
            </div>
        </div>
    );
}

function CodeBlock({ children, muted }) {
    return (
        <div
            className="font-mono text-xs break-all p-4 rounded-lg"
            style={{
                background: BG,
                color: muted ? TEXT_MUTED : TEXT,
                border: `1px solid ${BORDER}`,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)'
            }}
        >
            {children}
        </div>
    );
}

function PillButton({ icon, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded transition-colors bg-transparent cursor-pointer"
            style={{
                background: SURFACE_HIGH,
                color: TEXT_MUTED,
                border: `1px solid ${BORDER}`
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.color = ACCENT;
                e.currentTarget.style.borderColor = ACCENT;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.color = TEXT_MUTED;
                e.currentTarget.style.borderColor = BORDER;
            }}
        >
            <span className="material-symbols-outlined text-base">{icon}</span>
            {children}
        </button>
    );
}

export default CredentialDetails;
