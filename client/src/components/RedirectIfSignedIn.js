import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { fetchCurrentAdmin, fetchCurrentUser } from '../utils';
import { Spinner } from './ui/Primitives';

// The mirror of RequireAdmin, for the sign-in and sign-up screens. Someone
// who already has a session — Back button, a bookmark, a typed URL — goes
// to the signed-in landing page instead of a form for a session they
// already have. `admin` checks the admin session (a separate cookie from
// the shopper's) and lands on the user list.
//
// Checked once, on arrival. The screens navigate on their own after a
// successful sign-in, so this never competes with them.
const RedirectIfSignedIn = ({ admin = false, children }) => {
    const [state, setState] = useState({ loading: true, signedIn: false });

    useEffect(() => {
        let cancelled = false;
        (admin ? fetchCurrentAdmin() : fetchCurrentUser()).then((who) => {
            if (!cancelled) setState({ loading: false, signedIn: Boolean(who) });
        });
        return () => { cancelled = true; };
    }, [admin]);

    if (state.loading) {
        return (
            <div className={`min-h-screen flex flex-col items-center justify-center gap-4 ${admin ? 'authpage-dark' : ''}`}>
                <Spinner size={26} />
                <p className={`t-ui ${admin ? 'text-[#a1a1a6]' : 'dim'}`}>Checking your session…</p>
            </div>
        );
    }
    if (state.signedIn) return <Navigate to={admin ? '/admin/users' : '/home'} replace />;
    return children;
};

export default RedirectIfSignedIn;
