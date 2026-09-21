import React, { useState } from 'react';
import AdminShell from './AdminShell';
import AuthorizedApis from './AuthorizedApis';
import AuthRequestSheet from './AuthRequestSheet';

/**
 * Auth management is the connections themselves — nothing else.
 *
 * Requesting a new one is a dialog over this list, and the explanation of
 * what the OAuth hand-off actually does lives on the How it works page.
 */
function AuthManagement() {
    const [requestOpen, setRequestOpen] = useState(false);

    return (
        <AdminShell
            title="Auth management"
            subtitle="Connected stores and their tokens."
            actions={
                <button
                    type="button"
                    onClick={() => setRequestOpen(true)}
                    className="btn btn-blue btn-sm"
                >
                    Request API authorization
                </button>
            }
        >
            <div className="max-w-[1220px]">
                <AuthorizedApis onRequest={() => setRequestOpen(true)} />
            </div>

            <AuthRequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} />
        </AdminShell>
    );
}

export default AuthManagement;
