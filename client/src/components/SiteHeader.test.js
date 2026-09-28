import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SiteHeader from './SiteHeader';

const renderAt = (currentUser) =>
    render(
        <MemoryRouter initialEntries={['/home']}>
            <Routes>
                <Route path="/home" element={<SiteHeader currentUser={currentUser} setCurrentUser={() => {}} />} />
                <Route path="/login" element={<p>Sign-in page</p>} />
            </Routes>
        </MemoryRouter>
    );

test('signed out, "Sign in" goes straight to the sign-in page — no menu', async () => {
    const user = userEvent.setup();
    renderAt(null);

    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();

    await user.click(signIn);
    expect(screen.getByText('Sign-in page')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('signed in, the account button still opens the account menu', async () => {
    const user = userEvent.setup();
    renderAt({ name: 'Alex', email: 'alex@example.com' });

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Price alerts/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Log out/ })).toBeInTheDocument();
});
