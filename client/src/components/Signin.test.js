import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Signin from './Signin';
import { apiFetch, peekSignInReturn, rememberSignInReturn } from '../utils';

jest.mock('../utils', () => ({ ...jest.requireActual('../utils'), apiFetch: jest.fn() }));

const renderSignIn = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/login" element={<Signin />} />
                <Route path="/cart" element={<p>Cart page</p>} />
                <Route path="/home" element={<p>Home page</p>} />
            </Routes>
        </MemoryRouter>
    );

const signIn = async (user) => {
    await user.type(screen.getByLabelText('Email'), 'shopper@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
};

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, message: 'Login successful' }) });
});

test('after signing in, the shopper goes back to the page that sent them', async () => {
    const user = userEvent.setup();
    renderSignIn({ pathname: '/login', state: { from: { pathname: '/cart', search: '' } } });

    await signIn(user);

    expect(await screen.findByText('Cart page')).toBeInTheDocument();
});

test('with no page to return to, it still lands on home', async () => {
    const user = userEvent.setup();
    renderSignIn('/login');

    await signIn(user);

    expect(await screen.findByText('Home page')).toBeInTheDocument();
});

test('"Continue with Google" parks the return target for the round trip', () => {
    const target = { from: { pathname: '/cart', search: '' } };
    renderSignIn({ pathname: '/login', state: target });

    // jsdom can't follow the form's full-page GET; the submit handler is what matters.
    fireEvent.submit(screen.getByRole('button', { name: /Continue with Google/ }).closest('form'));

    expect(peekSignInReturn()).toEqual(target);
});

test('after a failed Google attempt (?error=, router state lost) the target is recovered', async () => {
    const user = userEvent.setup();
    rememberSignInReturn({ from: { pathname: '/cart', search: '' } });
    renderSignIn('/login?error=google_failed');

    await signIn(user);

    expect(await screen.findByText('Cart page')).toBeInTheDocument();
});
