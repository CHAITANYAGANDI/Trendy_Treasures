import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { fetchCurrentAdmin, fetchCurrentUser } from './utils';

// The route table itself: which screens a session skips, and what an
// address no route claims shows. Pages are stand-ins; the guards, the
// not-found pages and App's routes are the real ones.

jest.mock('./utils', () => ({
    ...jest.requireActual('./utils'),
    fetchCurrentUser: jest.fn(),
    fetchCurrentAdmin: jest.fn()
}));

// (jest.mock factories are hoisted above every import, so each builds its
// element inline rather than through a shared helper.)
jest.mock('./components/Home', () => () => require('react').createElement('p', null, 'Home page'));
jest.mock('./components/UserManagement', () => () => require('react').createElement('p', null, 'User list'));
jest.mock('./components/AdminLogin', () => () => require('react').createElement('p', null, 'Admin sign-in form'));
jest.mock('./components/Signin', () => () => require('react').createElement('p', null, 'Sign-in form'));
jest.mock('./components/Signup', () => () => require('react').createElement('p', null, 'Sign-up form'));
jest.mock('./components/VerifySignupOtp', () => () => require('react').createElement('p', null, 'Sign-up code form'));
jest.mock('./components/ForgotPassword', () => () => require('react').createElement('p', null, 'Recovery form'));

const SHOPPER = { name: 'Alex', email: 'alex@example.com' };
const ADMIN = { name: 'Sam', email: 'sam@example.com' };

const renderAt = (path) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <App />
        </MemoryRouter>
    );

beforeEach(() => {
    fetchCurrentUser.mockReset().mockResolvedValue(null);
    fetchCurrentAdmin.mockReset().mockResolvedValue(null);
});

test('a signed-in admin opening /admin/login lands on the user list', async () => {
    fetchCurrentAdmin.mockResolvedValue(ADMIN);
    renderAt('/admin/login');

    expect(await screen.findByText('User list')).toBeInTheDocument();
    expect(screen.queryByText('Admin sign-in form')).not.toBeInTheDocument();
});

test('a signed-out visitor at /admin/login gets the admin sign-in form', async () => {
    renderAt('/admin/login');
    expect(await screen.findByText('Admin sign-in form')).toBeInTheDocument();
});

test('a shopper session is not an admin one — /admin/login still asks an admin to sign in', async () => {
    fetchCurrentUser.mockResolvedValue(SHOPPER);
    renderAt('/admin/login');
    expect(await screen.findByText('Admin sign-in form')).toBeInTheDocument();
});

test('while the session is being checked, the form is not shown (no flash before a redirect)', async () => {
    fetchCurrentAdmin.mockReturnValue(new Promise(() => {}));
    renderAt('/admin/login');

    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(screen.queryByText('Admin sign-in form')).not.toBeInTheDocument();
});

test.each(['/login', '/signup', '/verify-signup'])('a signed-in shopper opening %s goes to /home', async (path) => {
    fetchCurrentUser.mockResolvedValue(SHOPPER);
    renderAt(path);
    expect(await screen.findByText('Home page')).toBeInTheDocument();
});

test('a guest at /login gets the sign-in form', async () => {
    renderAt('/login');
    expect(await screen.findByText('Sign-in form')).toBeInTheDocument();
});

test.each([
    ['/forgotpassword', () => fetchCurrentUser.mockResolvedValue(SHOPPER)],
    ['/admin/forgot', () => fetchCurrentAdmin.mockResolvedValue(ADMIN)]
])('%s stays open while signed in — it is the only way to change a password', async (path, signIn) => {
    signIn();
    renderAt(path);
    expect(await screen.findByText('Recovery form')).toBeInTheDocument();
});

test('an unknown address shows the storefront not-found page', async () => {
    renderAt('/no-such-page/at-all');

    expect(await screen.findByRole('heading', { name: 'Page not found.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse products' })).toHaveAttribute('href', '/home');
    // Still inside the storefront: its header and footer are there to carry on from.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
});

test('an unknown /admin address shows the admin not-found page', async () => {
    renderAt('/admin/no-such-page');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the admin portal' })).toHaveAttribute('href', '/admin/users');
    expect(screen.queryByRole('link', { name: 'Browse products' })).not.toBeInTheDocument();
});

test.each(['/admin', '/admin/dashboard', '/admin/register'])(
    'the catch-all does not swallow real admin addresses: %s still reaches the user list',
    async (path) => {
        fetchCurrentAdmin.mockResolvedValue(ADMIN);
        renderAt(path);
        expect(await screen.findByText('User list')).toBeInTheDocument();
    }
);

test('real storefront pages are not caught by the catch-all', async () => {
    renderAt('/home');
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Page not found.')).not.toBeInTheDocument();
});
