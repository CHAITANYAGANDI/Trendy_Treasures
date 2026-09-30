import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { fetchCurrentClient } from '../utils';

// The mirror of RequireAuth, for sign-in, registration and password reset.
// A developer who already has a session — Back button, a bookmark, a typed
// URL — goes to the dashboard instead of a form for a session they already
// have.
//
// Checked once, on arrival. The screens navigate on their own after a
// successful sign-in, so this never competes with them.
function RedirectIfSignedIn({ children }) {
    const [status, setStatus] = useState('checking'); // 'checking' | 'authed' | 'guest'

    useEffect(() => {
        let mounted = true;
        (async () => {
            const client = await fetchCurrentClient();
            if (!mounted) return;
            setStatus(client ? 'authed' : 'guest');
        })();
        return () => {
            mounted = false;
        };
    }, []);

    if (status === 'checking') {
        // Light, like the forms this stands in front of — a dark flash
        // before a light page reads as a glitch.
        return (
            <div
                style={{
                    minHeight: '100vh',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f8f9ff',
                    color: '#5f5e5e',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px'
                }}
            >
                Checking your session…
            </div>
        );
    }

    if (status === 'authed') {
        return <Navigate to="/auth/dashboard" replace />;
    }

    return children;
}

export default RedirectIfSignedIn;
