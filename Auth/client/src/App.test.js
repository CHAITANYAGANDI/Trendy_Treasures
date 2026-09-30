import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { fetchCurrentClient } from './utils';

// The route table itself: the landing page, which screens a session
// skips, and what an address no route claims shows.

jest.mock('./utils', () => ({ ...jest.requireActual('./utils'), fetchCurrentClient: jest.fn() }));
// jest.mock factories are hoisted above every import, so each builds its
// element inline.
jest.mock('./components/AuthDashboard', () => () => require('react').createElement('p', null, 'Dashboard'));
jest.mock('./components/AuthRegistration', () => () => require('react').createElement('p', null, 'Registration form'));
jest.mock('./components/AuthForgotPassword', () => () => require('react').createElement('p', null, 'Reset form'));

const DEVELOPER = { username: 'devname', email: 'dev@example.com' };

// index.js supplies a BrowserRouter; MemoryRouter stands in for it here.
const renderAt = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <App />
        </MemoryRouter>
    );

beforeEach(() => {
    fetchCurrentClient.mockReset().mockResolvedValue(null);
});

test('renders the AuthShield landing page at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /Ship secure API access/ })).toBeInTheDocument();
});

test.each(['/auth/login', '/auth/register', '/auth/forgot-password'])(
    'a signed-in developer opening %s lands on the dashboard',
    async (path) => {
        fetchCurrentClient.mockResolvedValue(DEVELOPER);
        renderAt(path);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    }
);

test('a guest at /auth/login gets the form — with the notice a password reset hands over', async () => {
    renderAt({ pathname: '/auth/login', state: { identifier: DEVELOPER.email, notice: 'Password updated. Sign in with your new password.' } });

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText('Password updated. Sign in with your new password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toHaveValue(DEVELOPER.email);
});

test('while the session is being checked, the form is not shown (no flash before a redirect)', () => {
    fetchCurrentClient.mockReturnValue(new Promise(() => {}));
    renderAt('/auth/login');

    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();
});

test.each(['/no-such-page', '/auth/no-such-page', '/auth/creds/abc/extra'])(
    'an unknown address (%s) shows the not-found page',
    (path) => {
        renderAt(path);
        expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Back to AuthShield/ })).toHaveAttribute('href', '/');
    }
);

test('the catch-all does not swallow real pages', async () => {
    fetchCurrentClient.mockResolvedValue(DEVELOPER);
    renderAt('/auth/dashboard');
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
});
