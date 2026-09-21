import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { fetchCurrentAdmin } from '../utils';
import { Spinner } from './ui/Primitives';

const RequireAdmin = ({ children }) => {
    const [state, setState] = useState({ loading: true, admin: null });

    useEffect(() => {
        let cancelled = false;
        fetchCurrentAdmin().then((admin) => {
            if (!cancelled) setState({ loading: false, admin });
        });
        return () => { cancelled = true; };
    }, []);

    if (state.loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4">
                <Spinner size={26} />
                <p className="t-ui dim">Checking admin access…</p>
            </div>
        );
    }
    if (!state.admin) return <Navigate to="/admin/login" replace />;
    return children;
};

export default RequireAdmin;
