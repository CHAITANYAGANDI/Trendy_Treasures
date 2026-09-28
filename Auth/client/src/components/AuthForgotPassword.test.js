import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthForgotPassword from './AuthForgotPassword';
import AuthLogin from './AuthLogin';

const EMAIL = 'dev@example.com';
const NEW_PW = 'FreshPass9x';

// Answers each reset endpoint from `responses` and records what was sent.
const mockApi = (responses) => {
    const calls = [];
    global.fetch = jest.fn((url, init = {}) => {
        const path = Object.keys(responses).find((p) => String(url).endsWith(p));
        calls.push({ path, body: init.body ? JSON.parse(init.body) : undefined });
        const { status = 200, body } = responses[path];
        return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    });
    return calls;
};

const renderFlow = () =>
    render(
        <MemoryRouter initialEntries={['/auth/forgot-password']}>
            <Routes>
                <Route path="/auth/forgot-password" element={<AuthForgotPassword />} />
                <Route path="/auth/login" element={<AuthLogin />} />
            </Routes>
        </MemoryRouter>
    );

const requestCode = async (user) => {
    await user.type(screen.getByLabelText('Email'), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByRole('heading', { name: 'Enter reset code' });
};

afterEach(() => {
    delete global.fetch;
});

test('asks for the code first, and only shows password fields once it is verified', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
        '/forgot-password': { body: { success: true } },
        '/verify-reset-code': { body: { success: true } },
        '/reset-password': { body: { success: true } }
    });
    renderFlow();

    await requestCode(user);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Reset code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    await screen.findByRole('heading', { name: 'Set a new password' });
    expect(screen.queryByLabelText('Reset code')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('New password'), NEW_PW);
    await user.type(screen.getByLabelText('Confirm new password'), 'Mismatch9x');
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), NEW_PW);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    // Lands on sign-in with the email prefilled, since login accepts it.
    const identifier = await screen.findByLabelText('Username or email');
    expect(identifier).toHaveValue(EMAIL);
    expect(screen.getByText(/Password reset\. Sign in with your email/)).toBeInTheDocument();

    expect(calls.map((c) => c.path)).toEqual(['/forgot-password', '/verify-reset-code', '/reset-password']);
    // Sent as a string, and re-checked by the server on the final step.
    expect(calls[2].body).toEqual({ email: EMAIL, otp: '123456', newPassword: NEW_PW });
});

test('a wrong code keeps the user on the code step with the server message', async () => {
    const user = userEvent.setup();
    mockApi({
        '/forgot-password': { body: { success: true } },
        '/verify-reset-code': {
            status: 400,
            body: { success: false, code: 'OTP_INCORRECT', message: 'Incorrect code. 4 attempt(s) remaining.' }
        }
    });
    renderFlow();

    await requestCode(user);
    await user.type(screen.getByLabelText('Reset code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByText('Incorrect code. 4 attempt(s) remaining.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enter reset code' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
});

test('an expired code sends the user back to request a new one', async () => {
    const user = userEvent.setup();
    mockApi({
        '/forgot-password': { body: { success: true } },
        '/verify-reset-code': {
            status: 400,
            body: { success: false, code: 'OTP_EXPIRED', message: 'Code is invalid or has expired' }
        }
    });
    renderFlow();

    await requestCode(user);
    await user.type(screen.getByLabelText('Reset code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    await screen.findByRole('heading', { name: 'Forgot password' });
    expect(screen.getByText('That code has expired. Request a new one below.')).toBeInTheDocument();
});
