import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowRight, FaUserShield } from 'react-icons/fa';
import { handleError, handleSuccess, apiFetch, readApiError } from '../utils';
import AuthLayout from './AuthLayout';

function AdminLogin() {
    const [loginInfo, setLoginInfo] = useState({ adminId: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setLoginInfo({ ...loginInfo, [name]: value });
    };

    const handleAdminLogin = async (e) => {
        e.preventDefault();
        const { adminId, password } = loginInfo;
        if (!adminId || !password) return handleError('Admin ID and password are required');

        setSubmitting(true);
        try {
            const response = await apiFetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loginInfo),
            });

            if (!response.ok) {
                // Status-driven so a rejected password always reads as a
                // rejected password. Parsing the body first meant a throttled
                // request (which never reached the password check at all)
                // reported whatever its body happened to contain.
                handleError(await readApiError(response, 'Login failed'));
                return;
            }

            const result = await response.json().catch(() => ({}));
            if (result.success) {
                handleSuccess('Login successful');
                setTimeout(() => navigate('/admin/dashboard'), 800);
            } else {
                handleError(result.message || 'Login failed');
            }
        } catch (err) {
            handleError(err.message || 'Login failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout
            eyebrow="Admin portal"
            title="Admin sign in"
            subtitle="Secure gateway for the Trendy Treasures operations team."
            panelTitle="Operations, simplified."
            panelSubtitle="Manage connected sellers, users and API authorizations from one focused dashboard."
        >
            <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                    <label htmlFor="adminId" className="field-label">Admin ID</label>
                    <div className="relative">
                        <FaUserShield className="absolute left-5 top-1/2 -translate-y-1/2 text-ink-400 text-sm" />
                        <input
                            id="adminId"
                            type="text"
                            name="adminId"
                            placeholder="Enter your Admin ID"
                            value={loginInfo.adminId}
                            onChange={handleChange}
                            required
                            autoFocus
                            className="field-input !pl-12"
                        />
                    </div>
                </div>
                <div>
                    <label htmlFor="password" className="field-label">Password</label>
                    <input
                        id="password"
                        type="password"
                        name="password"
                        placeholder="••••••••"
                        value={loginInfo.password}
                        onChange={handleChange}
                        required
                        className="field-input"
                    />
                </div>
                <button type="submit" disabled={submitting} className="btn-primary w-full !py-3.5">
                    {submitting ? 'Signing in…' : <>Sign in to admin <FaArrowRight className="text-xs" /></>}
                </button>

                <p className="text-xs text-ink-500 text-center pt-2">
                    Authorized personnel only. All admin activity is logged.
                </p>
            </form>
        </AuthLayout>
    );
}

export default AdminLogin;
