import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Users, KeyRound, BookOpen, LogOut, Menu, X } from 'lucide-react';
import BrandMark, { Wordmark } from './BrandMark';
import { handleSuccess, logoutAdmin } from '../utils';

// Two destinations, because the back office only has two jobs: the people
// with accounts, and the provider connections. Adding an admin is an action
// on the first; the authorized APIs are a section of the second. Neither
// earns a place in the navigation.
const NAV = [
    { to: '/admin/users', label: 'User management', icon: Users },
    { to: '/admin/auth', label: 'Auth management', icon: KeyRound },
    // Reference, not a working screen — it is what lets the two above stay
    // uncluttered by explanation.
    { to: '/admin/guide', label: 'Guide', icon: BookOpen },
];

/**
 * The shared admin shell — an App Store Connect-style sidebar on the left
 * and a title bar carrying the page's own actions. Below 1024 the sidebar
 * becomes a drawer.
 */
function AdminShell({ title, subtitle, actions, children }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();

    // Close the drawer on navigation and on Escape, and stop the page
    // behind it scrolling while it is open.
    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!mobileOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') setMobileOpen(false);
        };
        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [mobileOpen]);

    const handleLogout = async () => {
        await logoutAdmin();
        handleSuccess('Logged out successfully');
        setTimeout(() => navigate('/admin/login'), 800);
    };

    const navList = (
        <nav className="flex flex-col gap-0.5" aria-label="Admin sections">
            {NAV.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.to;
                return (
                    <Link
                        key={item.to}
                        to={item.to}
                        className="sidebar-item"
                        aria-current={active ? 'page' : undefined}
                    >
                        <Icon size={17} aria-hidden="true" />
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );

    const logoutButton = (
        <button type="button" onClick={handleLogout} className="sidebar-item sidebar-item-danger">
            <LogOut size={17} aria-hidden="true" />
            Log out
        </button>
    );

    const mark = (
        <Link to="/admin/users" className="flex items-center gap-2.5 px-2.5 pb-6 pt-1 no-underline text-ink">
            <BrandMark className="w-[26px] h-[26px] shrink-0" />
            <span>
                <Wordmark className="block text-ui leading-tight" />
                <span className="block text-[11px] dimmer mt-px">Admin</span>
            </span>
        </Link>
    );

    return (
        <div className="console">
            {/* Sidebar — 1024 and up */}
            <aside className="sidebar hidden lg:flex">
                {mark}
                {navList}
                <div className="mt-auto pt-3.5 border-t border-hairline">{logoutButton}</div>
            </aside>

            {/* Drawer — below 1024 */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-[120]">
                    <div className="scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
                    <aside
                        className="sidebar absolute left-0 top-0 bottom-0 w-[272px] animate-popIn"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Admin navigation"
                    >
                        <div className="flex items-start justify-between">
                            {mark}
                            <button
                                type="button"
                                onClick={() => setMobileOpen(false)}
                                className="icon-btn"
                                aria-label="Close menu"
                            >
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>
                        {navList}
                        <div className="mt-auto pt-3.5 border-t border-hairline">{logoutButton}</div>
                    </aside>
                </div>
            )}

            <div className="min-w-0 bg-paper flex flex-col">
                <header className="console-bar">
                    <button
                        type="button"
                        onClick={() => setMobileOpen(true)}
                        className="icon-btn lg:hidden"
                        aria-label="Open menu"
                    >
                        <Menu size={19} aria-hidden="true" />
                    </button>

                    <div className="min-w-0">
                        <h1 className="t-h3 truncate">{title}</h1>
                        {subtitle && <p className="text-cap dimmer truncate mt-0.5">{subtitle}</p>}
                    </div>

                    {actions && (
                        <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>
                    )}
                </header>

                <main className="console-body">{children}</main>
            </div>
        </div>
    );
}

export default AdminShell;
