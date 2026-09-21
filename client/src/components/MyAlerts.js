import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellRing, Trash2, ChevronLeft } from 'lucide-react';
import {
    deletePriceAlert,
    fetchCurrentUser,
    handleError,
    handleSuccess,
    listPriceAlerts,
    showConfirm
} from '../utils';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import SourcePill from './SourcePill';
import { EmptyState, Spinner } from './ui/Primitives';

const fmtPrice = (n) => `$${Number(n).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function MyAlerts() {
    const [currentUser, setCurrentUser] = useState(null);
    const [alerts, setAlerts] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetchCurrentUser().then((u) => {
            // apiFetch already bounces unauthenticated users to /login, so
            // if we land here without a user it's a transient state.
            setCurrentUser(u);
        });
        refresh();
    }, []);

    const refresh = async () => {
        setLoading(true);
        try {
            const res = await listPriceAlerts();
            if (res.ok) {
                const data = await res.json();
                setAlerts(data.alerts || []);
            } else {
                handleError('Failed to load your alerts.');
                setAlerts([]);
            }
        } catch (err) {
            handleError(err.message || 'Failed to load your alerts.');
            setAlerts([]);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (alert) => {
        const ok = await showConfirm({
            title: 'Stop tracking this product?',
            body: `You won't receive any more price alerts for "${alert.product_name}".`,
            confirmLabel: 'Stop tracking',
            cancelLabel: 'Keep tracking',
            danger: true
        });
        if (!ok) return;

        try {
            const res = await deletePriceAlert(alert._id);
            if (res.ok) {
                handleSuccess('Alert removed.');
                setAlerts((prev) => prev.filter((a) => a._id !== alert._id));
            } else {
                const data = await res.json().catch(() => ({}));
                handleError(data.message || 'Failed to delete alert.');
            }
        } catch (err) {
            handleError(err.message || 'Failed to delete alert.');
        }
    };

    return (
        <div className="min-h-screen flex flex-col">
            <SiteHeader currentUser={currentUser} setCurrentUser={setCurrentUser} showSearch={false} />

            <div className="pagebar">
                <div className="pagebar-inner">
                    <button type="button" onClick={() => navigate(-1)} className="btn btn-plain !px-0">
                        <ChevronLeft size={15} aria-hidden="true" /> Back
                    </button>
                </div>
            </div>

            <main className="shell-page py-8 md:py-12 flex-1 w-full">
                <header className="mb-8">
                    <h1 className="t-d3">Price alerts</h1>
                    <p className="t-lead dim mt-2 measure">
                        We'll email you when any of these products drop below your threshold.
                    </p>
                </header>

                {loading ? (
                    <div className="py-20 flex flex-col items-center gap-3">
                        <Spinner size={24} />
                        <p className="t-ui dim">Loading alerts…</p>
                    </div>
                ) : alerts && alerts.length === 0 ? (
                    <EmptyState
                        glyph={<BellRing size={38} className="glyph" aria-hidden="true" />}
                        title="No price alerts yet."
                        action={
                            <Link to="/home" className="btn btn-blue btn-lg">
                                Browse products
                            </Link>
                        }
                    >
                        Open any product, scroll to the chart, and tap <em>Track price</em>.
                    </EmptyState>
                ) : (
                    <ul className="border-t border-hairline">
                        {(alerts || []).map((alert) => {
                            const lastNotified = alert.last_notified_at
                                ? `last notified ${fmtDate(alert.last_notified_at)}`
                                : 'never notified';
                            return (
                                <li
                                    key={alert._id}
                                    className="flex flex-wrap items-start gap-4 py-5 border-b border-hairlineSoft"
                                >
                                    <div className="flex-1 min-w-[220px]">
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <SourcePill provider={alert.provider} size="xs" />
                                            <span className="t-cap dimmer">
                                                created {fmtDate(alert.created_at)} · {lastNotified}
                                            </span>
                                        </div>

                                        <p className="t-body font-medium mt-2 clamp2">
                                            {alert.product_name}
                                        </p>

                                        <p className="t-ui dim mt-1.5">
                                            Notify when price ≤{' '}
                                            <span className="font-semibold text-ink tnum">
                                                {fmtPrice(alert.threshold_price)}
                                            </span>
                                            {' · '}
                                            <span className="dimmer tnum">
                                                last known {fmtPrice(alert.last_known_price)}
                                            </span>
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Link
                                            to={`/product/${alert.provider}/${alert.product_id}`}
                                            className="btn btn-quiet btn-sm"
                                            title="View product"
                                        >
                                            View
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(alert)}
                                            className="icon-btn icon-btn-danger"
                                            aria-label={`Stop tracking ${alert.product_name}`}
                                            title="Stop tracking"
                                        >
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </main>

            <SiteFooter />
        </div>
    );
}

export default MyAlerts;
