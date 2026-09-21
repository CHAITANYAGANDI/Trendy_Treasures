import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, Eye, EyeOff } from 'lucide-react';
import { handleError, handleSuccess, apiFetch, readApiError } from '../utils';
import AuthLayout from './AuthLayout';
import { Field } from './ui/Primitives';

function AdminLogin() {
    const [loginInfo, setLoginInfo] = useState({ adminId: '', password: '' });
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setLoginInfo({ ...loginInfo, [name]: value });
    };

    const handleAdminLogin = async (e) => {
        e.preventDefault();
        const { adminId, password } = loginInfo;
        if (!adminId || !password) return handleError('Admin email and password are required');

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
                setTimeout(() => navigate('/admin/users'), 800);
            } else {
                handleError(result.message || 'Login failed');
            }
        } catch (err) {
            handleError(err.message || 'Login failed');
        } finally {
            setSubmitting(false);
        }
    };

    // Dark appearance, no search, no Google, no route to sign up. The change
    // of appearance is itself the signal that this is the operations side.
    return (
        <AuthLayout
            dark
            eyebrow="Admin portal"
            title="Admin sign in"
            subtitle="Secure gateway for the Trendy Treasures operations team."
            footer={
                <>
                    Looking for your shopping account?{' '}
                    <Link to="/login" className="link font-medium !text-[#2997ff]">
                        Sign in to the store
                    </Link>
                </>
            }
        >
            <form onSubmit={handleAdminLogin} className="flex flex-col gap-3">
                <Field
                    id="adminEmail"
                    name="adminId"
                    type="email"
                    label="Admin email"
                    value={loginInfo.adminId}
                    onChange={handleChange}
                    className="field-dark"
                    required
                    autoFocus
                    autoComplete="username"
                    spellCheck="false"
                />
                <Field
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    label="Password"
                    value={loginInfo.password}
                    onChange={handleChange}
                    className="field-dark"
                    required
                    autoComplete="current-password"
                    trailing={
                        <button
                            type="button"
                            className="field-reveal"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    }
                />

                <p className="text-right">
                    <Link to="/admin/forgot" className="link t-ui">Forgot password?</Link>
                </p>

                <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-lg btn-full mt-2 !bg-[#0a84ff] !text-white hover:!bg-[#3d9bff]"
                >
                    {submitting ? 'Signing in…' : 'Sign in to admin'}
                </button>
            </form>

            <div className="mt-7 flex flex-col gap-2.5">
                <p className="flex gap-2.5 text-cap text-[#8e8e93] leading-relaxed">
                    <ShieldCheck size={15} className="shrink-0 mt-px text-[#636366]" aria-hidden="true" />
                    <span>Authorized personnel only. All admin activity is logged.</span>
                </p>
                <p className="flex gap-2.5 text-cap text-[#8e8e93] leading-relaxed">
                    <Lock size={15} className="shrink-0 mt-px text-[#636366]" aria-hidden="true" />
                    <span>
                        Admin accounts are created by another admin. Resetting a password
                        emails a code to that address.
                    </span>
                </p>
            </div>
        </AuthLayout>
    );
}

export default AdminLogin;
