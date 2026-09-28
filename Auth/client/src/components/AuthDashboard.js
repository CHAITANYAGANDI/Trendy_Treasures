import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
const SURFACE_HIGH = '#282a32';
const SURFACE_LOW = '#191b23';
const BORDER = '#33343d';
const TEXT = '#e2e1ed';
const TEXT_MUTED = '#c3c6d6';
const TEXT_DIM = '#8d909f';

const PAGE_SIZE = 8;

const truncate = (s, head = 14, tail = 3) => {
    if (!s) return '';
    if (s.length <= head + tail + 1) return s;
    return `${s.slice(0, head)}...${s.slice(-tail)}`;
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

const daysSince = (d) => {
    if (!d) return Infinity;
    return (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
};

const ROTATION_THRESHOLD_DAYS = 90;

const getStatus = (creationDate) => {
    if (daysSince(creationDate) >= ROTATION_THRESHOLD_DAYS) {
        return { label: 'Pending Rotation', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' };
    }
    return { label: 'Active', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
};

function AuthDashboard() {
    const [credentials, setCredentials] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [accountOpen, setAccountOpen] = useState(false);
    const [rowMenu, setRowMenu] = useState(null); // { id, top, right }
    const [clientName, setClientName] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const navigate = useNavigate();
    const accountRef = useRef(null);
    const rowMenuRef = useRef(null);

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

    const fetchCredentials = async () => {
        try {
            const response = await authFetch('/dashboard', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                setCredentials(result.credentials || []);
            } else {
                handleError(result.message || 'Failed to fetch credentials.');
            }
        } catch (err) {
            handleError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCredentials();
        fetchCurrentClient().then((c) => {
            if (c && (c.name || c.username)) {
                setClientName(c.name || c.username);
            }
        });
    }, []);

    useEffect(() => {
        const onDocClick = (e) => {
            if (accountRef.current && !accountRef.current.contains(e.target)) {
                setAccountOpen(false);
            }
            if (rowMenuRef.current && !rowMenuRef.current.contains(e.target)) {
                setRowMenu(null);
            }
        };
        const onScroll = () => setRowMenu(null);
        document.addEventListener('mousedown', onDocClick);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return credentials;
        return credentials.filter((c) =>
            (c.api_name || '').toLowerCase().includes(q) ||
            (c.client_id || '').toLowerCase().includes(q) ||
            (c.api_url || '').toLowerCase().includes(q)
        );
    }, [credentials, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageStart = (safePage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

    const stats = useMemo(() => {
        const totalCreds = credentials.length;
        const uniqueApis = new Set(
            credentials.map((c) => (c.api_url || '').replace(/\/$/, '').toLowerCase()).filter(Boolean)
        ).size;
        const uniqueRedirects = new Set(
            credentials.map((c) => (c.redirect_uri || '').toLowerCase()).filter(Boolean)
        ).size;
        const last30 = credentials.filter((c) => daysSince(c.creation_date) <= 30).length;
        return { totalCreds, uniqueApis, uniqueRedirects, last30 };
    }, [credentials]);

    const handleLogout = async () => {
        await logoutClient();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/auth/login'), 800);
    };

    const handleCreateCredentials = () => {
        setShowCreateModal(true);
    };

    const handleCreateSuccess = async () => {
        setShowCreateModal(false);
        setLoading(true);
        await fetchCredentials();
    };

    const handleViewDetails = (id) => {
        setRowMenu(null);
        navigate(`/auth/creds/${id}`);
    };

    const copyToClipboard = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            handleSuccess(`${label} copied to clipboard`);
        } catch {
            handleError(`Could not copy ${label}`);
        }
        setRowMenu(null);
    };

    const handleDeleteCredential = (cred) => {
        setRowMenu(null);
        setDeleteTarget(cred);
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        const cred = deleteTarget;
        setDeleting(true);
        try {
            const response = await authFetch(`/credentials/${cred._id}`, {
                method: 'DELETE'
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                handleSuccess('Credential deleted');
                setCredentials((prev) => prev.filter((c) => c._id !== cred._id));
                setDeleteTarget(null);
            } else {
                handleError(result.message || 'Could not delete credential');
            }
        } catch (err) {
            handleError(err.message);
        } finally {
            setDeleting(false);
        }
    };

    const openRowMenu = (cred, btn) => {
        const rect = btn.getBoundingClientRect();
        setRowMenu({
            id: cred._id,
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right
        });
    };

    return (
        <div
            className="font-body antialiased min-h-screen w-full flex flex-col"
            style={{ background: BG, color: TEXT }}
        >
            <header
                className="w-full h-16"
                style={{ background: '#0c0e15', borderBottom: `1px solid ${BORDER}` }}
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
                        <div className="relative" ref={accountRef}>
                            <button
                                onClick={() => setAccountOpen((v) => !v)}
                                className="flex items-center justify-center p-2 rounded-full transition-colors focus:outline-none"
                                style={{ color: TEXT_MUTED, background: 'transparent' }}
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

            <main className="flex-grow w-full px-4 md:px-12 py-12">
                <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="font-headline font-bold text-3xl md:text-4xl" style={{ color: TEXT }}>
                            Auth Dashboard
                        </h1>
                        <p className="text-base mt-2" style={{ color: TEXT_MUTED }}>
                            Manage your active APIs, credentials, and security redirects.
                        </p>
                    </div>
                    <button
                        onClick={handleCreateCredentials}
                        className="font-medium text-sm px-4 py-2.5 rounded flex items-center justify-center gap-2 transition-opacity whitespace-nowrap"
                        style={{ background: ACCENT, color: '#ffffff' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                    >
                        <span className="material-symbols-outlined text-lg">add</span>
                        Create New Credentials
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    <StatCard label="Total Credentials" icon="key" value={stats.totalCreds} />
                    <StatCard label="Unique APIs" icon="api" value={stats.uniqueApis} />
                    <StatCard label="Redirect URIs" icon="route" value={stats.uniqueRedirects} />
                    <StatCard
                        label="Created (30d)"
                        icon="query_stats"
                        value={stats.last30}
                        trendLabel="Last 30 days"
                    />
                </div>

                <div
                    className="rounded-lg overflow-hidden"
                    style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
                >
                    <div
                        className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4"
                        style={{ borderBottom: `1px solid ${BORDER}` }}
                    >
                        <h2 className="font-headline font-semibold text-xl" style={{ color: TEXT }}>
                            Credentials
                        </h2>
                        <div className="relative w-full md:w-96">
                            <span
                                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg"
                                style={{ color: TEXT_DIM }}
                            >
                                search
                            </span>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                                placeholder="Search API name, client ID, or URL..."
                                className="w-full h-10 pl-10 pr-4 rounded text-sm font-body transition-colors outline-none"
                                style={{
                                    background: BG,
                                    color: TEXT,
                                    border: `1px solid ${BORDER}`
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                                onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead style={{ background: SURFACE_HIGH }}>
                                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                                    <Th>Name</Th>
                                    <Th>Client ID</Th>
                                    <Th>Status</Th>
                                    <Th>Creation Date</Th>
                                    <Th align="right">Actions</Th>
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="py-12 px-6 text-center" style={{ color: TEXT_MUTED }}>
                                            Loading credentials…
                                        </td>
                                    </tr>
                                ) : pageRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-12 px-6 text-center" style={{ color: TEXT_MUTED }}>
                                            {credentials.length === 0
                                                ? 'No credentials created yet.'
                                                : 'No credentials match your search.'}
                                        </td>
                                    </tr>
                                ) : (
                                    pageRows.map((cred) => {
                                        const status = getStatus(cred.creation_date);
                                        return (
                                        <tr
                                            key={cred._id}
                                            style={{ borderBottom: `1px solid ${BORDER}` }}
                                            className="transition-colors hover:bg-white/5"
                                        >
                                            <td className="py-4 px-6">
                                                <button
                                                    onClick={() => handleViewDetails(cred._id)}
                                                    className="font-medium transition-colors text-left bg-transparent border-0 cursor-pointer hover:underline"
                                                    style={{ color: ACCENT }}
                                                >
                                                    {cred.api_name}
                                                </button>
                                            </td>
                                            <td className="py-4 px-6">
                                                <span
                                                    className="px-2 py-1 rounded font-mono text-xs"
                                                    style={{ background: SURFACE_HIGH, color: TEXT_MUTED }}
                                                >
                                                    {truncate(cred.client_id, 14, 3)}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6">
                                                <span
                                                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                                                    style={{ background: status.bg, color: status.color }}
                                                >
                                                    {status.label}
                                                </span>
                                            </td>
                                            <td
                                                className="py-4 px-6 font-mono text-xs"
                                                style={{ color: TEXT_MUTED }}
                                            >
                                                {formatDate(cred.creation_date)}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <button
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => {
                                                        if (rowMenu && rowMenu.id === cred._id) {
                                                            setRowMenu(null);
                                                        } else {
                                                            openRowMenu(cred, e.currentTarget);
                                                        }
                                                    }}
                                                    className="p-1 rounded-full focus:outline-none transition-colors"
                                                    style={{ color: TEXT_DIM, background: 'transparent' }}
                                                    onMouseEnter={(e) =>
                                                        (e.currentTarget.style.background = SURFACE_HIGH)
                                                    }
                                                    onMouseLeave={(e) =>
                                                        (e.currentTarget.style.background = 'transparent')
                                                    }
                                                    aria-label="Row actions"
                                                >
                                                    <span className="material-symbols-outlined text-lg">
                                                        more_vert
                                                    </span>
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div
                        className="p-4 flex justify-between items-center"
                        style={{ borderTop: `1px solid ${BORDER}`, background: SURFACE_LOW }}
                    >
                        <span className="text-sm" style={{ color: TEXT_MUTED }}>
                            {filtered.length === 0
                                ? 'No results'
                                : `Showing ${pageStart + 1}-${Math.min(
                                      pageStart + PAGE_SIZE,
                                      filtered.length
                                  )} of ${filtered.length}`}
                        </span>
                        <div className="flex gap-2">
                            <PagerButton
                                disabled={safePage <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                Prev
                            </PagerButton>
                            <PagerButton
                                disabled={safePage >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            >
                                Next
                            </PagerButton>
                        </div>
                    </div>
                </div>
            </main>

            {rowMenu && (() => {
                const cred = credentials.find((c) => c._id === rowMenu.id);
                if (!cred) return null;
                return (
                    <div
                        ref={rowMenuRef}
                        className="fixed w-52 rounded-lg shadow-2xl py-1 text-left"
                        style={{
                            top: rowMenu.top,
                            right: rowMenu.right,
                            background: SURFACE,
                            border: `1px solid ${BORDER}`,
                            zIndex: 200
                        }}
                    >
                        <MenuItem onClick={() => handleViewDetails(cred._id)}>
                            View details
                        </MenuItem>
                        <MenuItem
                            onClick={() => copyToClipboard(cred.client_id, 'Client ID')}
                        >
                            Copy Client ID
                        </MenuItem>
                        <div style={{ borderTop: `1px solid ${BORDER}`, margin: '4px 0' }} />
                        <MenuItem
                            onClick={() => handleDeleteCredential(cred)}
                            danger
                        >
                            Delete Credential
                        </MenuItem>
                    </div>
                );
            })()}

            {showCreateModal && (
                <CreateCredentialModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={handleCreateSuccess}
                />
            )}

            {deleteTarget && (
                <DeleteCredentialModal
                    credential={deleteTarget}
                    onClose={() => !deleting && setDeleteTarget(null)}
                    onConfirm={confirmDelete}
                    deleting={deleting}
                />
            )}
        </div>
    );
}

function CreateCredentialModal({ onClose, onSuccess }) {
    const [form, setForm] = useState({
        api_name: '',
        api_url: '',
        redirect_uri: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [errorBanner, setErrorBanner] = useState('');
    // After a successful create the server returns { client_id, client_secret }
    // in plaintext exactly once. Store them here to render the reveal panel.
    const [created, setCreated] = useState(null);

    const closeAndMaybeRefresh = () => {
        if (created) onSuccess();
        else onClose();
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') closeAndMaybeRefresh();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [created]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm((f) => ({ ...f, [name]: value }));
        if (errorBanner) setErrorBanner('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { api_name, api_url, redirect_uri } = form;
        if (!api_name || !api_url || !redirect_uri) {
            return setErrorBanner('All fields are required.');
        }
        setSubmitting(true);
        setErrorBanner('');
        try {
            const response = await authFetch('/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.success) {
                handleSuccess('Credentials created successfully');
                setCreated({
                    client_id: result.client_id,
                    client_secret: result.client_secret
                });
                return;
            }
            if (response.status === 409) {
                setErrorBanner(
                    result.message ||
                        'You already have a credential with this API name. Pick a different name.'
                );
            } else if (result.error && result.error.details && result.error.details[0]) {
                setErrorBanner(result.error.details[0].message);
            } else {
                setErrorBanner(result.message || 'Could not create credential.');
            }
        } catch (err) {
            setErrorBanner(err.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const copy = async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
            handleSuccess(`${label} copied to clipboard`);
        } catch {
            handleError(`Could not copy ${label}`);
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
                    onClick={closeAndMaybeRefresh}
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
                    {!created ? (
                        <>
                            <div className="mb-6">
                                <h2 className="font-headline font-bold text-2xl" style={{ color: TEXT }}>
                                    Create New API Credentials
                                </h2>
                                <p className="mt-1 text-sm" style={{ color: TEXT_MUTED }}>
                                    Configure your application to access the Client Portal APIs.
                                </p>
                            </div>

                            {errorBanner && (
                                <div
                                    className="text-sm rounded p-3 mb-5 flex items-start gap-2"
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.12)',
                                        color: '#fca5a5',
                                        border: '1px solid rgba(239, 68, 68, 0.3)'
                                    }}
                                    role="alert"
                                >
                                    <span className="material-symbols-outlined text-base mt-px">error</span>
                                    <span>{errorBanner}</span>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <ModalField
                                    id="api_name"
                                    label="API Name"
                                    hint="Give your API a recognizable name"
                                    value={form.api_name}
                                    onChange={handleChange}
                                    type="text"
                                />
                                <ModalField
                                    id="api_url"
                                    label="API URL"
                                    hint="The base endpoint for your service"
                                    value={form.api_url}
                                    onChange={handleChange}
                                    type="url"
                                />
                                <ModalField
                                    id="redirect_uri"
                                    label="Redirect URI"
                                    hint="The URL where users are sent after auth"
                                    value={form.redirect_uri}
                                    onChange={handleChange}
                                    type="url"
                                />

                                <div
                                    className="pt-6 flex justify-between items-center"
                                    style={{ borderTop: `1px solid ${BORDER}` }}
                                >
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        disabled={submitting}
                                        className="text-sm font-medium transition-colors bg-transparent border-0 cursor-pointer disabled:opacity-50"
                                        style={{ color: TEXT_MUTED }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = ACCENT)}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_MUTED)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="text-sm font-semibold px-6 py-2.5 rounded transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                                        style={{ background: ACCENT, color: '#ffffff', border: 'none' }}
                                        onMouseEnter={(e) => {
                                            if (!submitting) e.currentTarget.style.opacity = '0.9';
                                        }}
                                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                    >
                                        {submitting ? 'Creating…' : 'Create'}
                                    </button>
                                </div>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="mb-6">
                                <div
                                    className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
                                    style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
                                >
                                    <span className="material-symbols-outlined text-3xl">check_circle</span>
                                </div>
                                <h2 className="font-headline font-bold text-2xl" style={{ color: TEXT }}>
                                    Save your client secret
                                </h2>
                                <p className="mt-1 text-sm" style={{ color: TEXT_MUTED }}>
                                    This is the only time we'll show your client secret. Store it
                                    somewhere safe — if you lose it you'll need to rotate.
                                </p>
                            </div>

                            <div className="space-y-4 mb-6">
                                <RevealField
                                    label="Client ID"
                                    value={created.client_id}
                                    onCopy={() => copy(created.client_id, 'Client ID')}
                                />
                                <RevealField
                                    label="Client Secret"
                                    value={created.client_secret}
                                    onCopy={() => copy(created.client_secret, 'Client Secret')}
                                    danger
                                    masked
                                />
                            </div>

                            <div
                                className="pt-6 flex justify-end"
                                style={{ borderTop: `1px solid ${BORDER}` }}
                            >
                                <button
                                    type="button"
                                    onClick={onSuccess}
                                    className="text-sm font-semibold px-6 py-2.5 rounded transition-all cursor-pointer"
                                    style={{ background: ACCENT, color: '#ffffff', border: 'none' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                                >
                                    I've saved it — done
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function RevealField({ label, value, onCopy, danger, masked }) {
    const boxStyle = {
        background: 'rgba(11,13,27,0.6)',
        color: TEXT,
        border: `1px solid ${danger ? 'rgba(239,68,68,0.4)' : BORDER}`
    };
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label
                    className="text-xs uppercase tracking-wider font-medium"
                    style={{ color: danger ? '#fca5a5' : TEXT_MUTED }}
                >
                    {label}
                </label>
                <button
                    type="button"
                    onClick={onCopy}
                    className="text-xs font-medium flex items-center gap-1 bg-transparent border-0 cursor-pointer"
                    style={{ color: ACCENT }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    Copy
                </button>
            </div>
            {masked ? (
                <MaskedSecret value={value} label={label} style={boxStyle} />
            ) : (
                <div className="p-3 rounded font-mono text-xs break-all" style={boxStyle}>
                    {value}
                </div>
            )}
        </div>
    );
}

function ModalField({ id, label, hint, value, onChange, type = 'text' }) {
    return (
        <div>
            <label
                htmlFor={id}
                className="block text-xs uppercase tracking-wider font-medium mb-2"
                style={{ color: TEXT_MUTED }}
            >
                {label}
            </label>
            <input
                id={id}
                name={id}
                type={type}
                value={value}
                onChange={onChange}
                required
                className="block w-full h-10 px-4 rounded text-sm font-body outline-none transition-colors"
                style={{
                    background: 'rgba(11,13,27,0.6)',
                    color: TEXT,
                    border: `1px solid ${BORDER}`
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            />
            {hint && (
                <p className="mt-2 text-xs" style={{ color: TEXT_DIM }}>
                    {hint}
                </p>
            )}
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

function StatCard({ label, icon, value, trendLabel }) {
    return (
        <div
            className="rounded-lg p-6 relative overflow-hidden"
            style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
        >
            <div className="flex items-center justify-between mb-4">
                <span
                    className="text-xs uppercase tracking-wider font-medium"
                    style={{ color: TEXT_MUTED }}
                >
                    {label}
                </span>
                <span className="material-symbols-outlined" style={{ color: TEXT_DIM }}>
                    {icon}
                </span>
            </div>
            <div>
                <span className="font-headline font-bold text-4xl" style={{ color: TEXT }}>
                    {value}
                </span>
                {trendLabel && (
                    <div className="flex items-center mt-2" style={{ color: ACCENT }}>
                        <span className="material-symbols-outlined text-sm mr-1">trending_up</span>
                        <span className="text-xs">{trendLabel}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function Th({ children, align }) {
    return (
        <th
            className={`py-4 px-6 text-xs uppercase tracking-wider font-medium ${
                align === 'right' ? 'text-right' : ''
            }`}
            style={{ color: TEXT_MUTED }}
        >
            {children}
        </th>
    );
}

function MenuItem({ children, onClick, danger }) {
    const color = danger ? '#ef4444' : TEXT;
    return (
        <button
            onClick={onClick}
            className="block w-full text-left px-4 py-2 text-sm transition-colors bg-transparent border-0 cursor-pointer"
            style={{ color }}
            onMouseEnter={(e) => (e.currentTarget.style.background = SURFACE_HIGH)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
            {children}
        </button>
    );
}

function PagerButton({ children, disabled, onClick }) {
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className="px-3 py-1 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
                color: TEXT_MUTED,
                border: `1px solid ${BORDER}`,
                background: 'transparent'
            }}
            onMouseEnter={(e) => {
                if (!disabled) {
                    e.currentTarget.style.color = ACCENT;
                    e.currentTarget.style.borderColor = ACCENT;
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.color = TEXT_MUTED;
                e.currentTarget.style.borderColor = BORDER;
            }}
        >
            {children}
        </button>
    );
}

export default AuthDashboard;
