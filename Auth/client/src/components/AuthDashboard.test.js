import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthDashboard from './AuthDashboard';

const CLIENT_ID = 'auth_id_example';
const CLIENT_SECRET = 'auth_sk_live_example_not_a_real_secret';

// Enough of a fetch Response for authFetch, which reads content-type and
// clones bodies to capture CSRF tokens.
const jsonResponse = (body, status = 200) => {
    const make = () => ({
        ok: status < 400,
        status,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: () => Promise.resolve(body),
        clone: make
    });
    return make();
};

beforeEach(() => {
    global.fetch = jest.fn((url, init = {}) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/dashboard')) return Promise.resolve(jsonResponse({ success: true, credentials: [] }));
        if (path.endsWith('/me')) {
            return Promise.resolve(jsonResponse({ success: true, client: { name: 'Dev', username: 'dev' } }));
        }
        if (path.endsWith('/credentials') && init.method === 'POST') {
            return Promise.resolve(
                jsonResponse({ success: true, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }, 201)
            );
        }
        return Promise.resolve(jsonResponse({ success: false }, 404));
    });
});

afterEach(() => {
    delete global.fetch;
});

test('a newly created client secret is masked until the user reveals it', async () => {
    const user = userEvent.setup();
    render(
        <MemoryRouter>
            <AuthDashboard />
        </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: /Create New Credentials/ }));
    await user.type(screen.getByLabelText('API Name'), 'Orders');
    await user.type(screen.getByLabelText('API URL'), 'https://api.example.com/orders');
    await user.type(screen.getByLabelText('Redirect URI'), 'https://app.example.com/callback');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await screen.findByRole('heading', { name: 'Save your client secret' });

    // The client ID stays readable; the secret is only dots.
    expect(screen.getByText(CLIENT_ID)).toBeInTheDocument();
    expect(screen.queryByText(CLIENT_SECRET)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show Client Secret' }));
    expect(screen.getByText(CLIENT_SECRET)).toBeInTheDocument();
});
