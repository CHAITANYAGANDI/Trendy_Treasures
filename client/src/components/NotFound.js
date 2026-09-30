import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { fetchCurrentUser } from '../utils';
import AuthLayout from './AuthLayout';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import { EmptyState } from './ui/Primitives';

// Any address no route claims. The admin variant keeps the portal's dark
// appearance and leads back into it (through RequireAdmin, so a signed-out
// visitor ends up at the admin sign-in); the storefront one keeps the
// header and footer so the shopper can carry on from here.
function NotFound({ admin = false }) {
    const [currentUser, setCurrentUser] = useState(null);

    useEffect(() => {
        if (admin) return undefined;
        let cancelled = false;
        fetchCurrentUser().then((u) => {
            if (!cancelled) setCurrentUser(u);
        });
        return () => { cancelled = true; };
    }, [admin]);

    if (admin) {
        return (
            <AuthLayout
                dark
                eyebrow="Admin portal"
                title="Page not found"
                subtitle="There's no admin page at this address. It may have moved, or the link may be mistyped."
            >
                <Link
                    to="/admin/users"
                    className="btn btn-lg btn-full !bg-[#0a84ff] !text-white hover:!bg-[#3d9bff]"
                >
                    Go to the admin portal
                </Link>
            </AuthLayout>
        );
    }

    return (
        <div className="min-h-screen flex flex-col">
            <SiteHeader currentUser={currentUser} setCurrentUser={setCurrentUser} showSearch={false} />

            <main className="shell-page flex-1 w-full flex flex-col justify-center">
                <EmptyState
                    glyph={<SearchX size={38} className="glyph" aria-hidden="true" />}
                    title="Page not found."
                    action={
                        <Link to="/home" className="btn btn-blue btn-lg">
                            Browse products
                        </Link>
                    }
                >
                    The page you're looking for doesn't exist. It may have moved, or the link may be mistyped.
                </EmptyState>
            </main>

            <SiteFooter />
        </div>
    );
}

export default NotFound;
