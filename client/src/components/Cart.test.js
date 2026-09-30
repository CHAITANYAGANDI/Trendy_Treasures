import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Cart from './Cart';
import { fetchCurrentUser } from '../utils';

jest.mock('../utils', () => ({ ...jest.requireActual('../utils'), fetchCurrentUser: jest.fn() }));

function SignInProbe() {
    const location = useLocation();
    return <pre data-testid="login-state">{JSON.stringify(location.state)}</pre>;
}

test('"Sign in to check out" remembers the cart, so sign-in comes back to it', async () => {
    const user = userEvent.setup();
    fetchCurrentUser.mockResolvedValue(null);
    localStorage.setItem('guestCart', JSON.stringify([{
        productName: 'Citrus Squeezer Yellow',
        productPrice: 8.99,
        productQuantity: 1,
        productSoldBy: 'Walmart',
        source: 'walmart',
        providerProductId: '12'
    }]));

    render(
        <MemoryRouter initialEntries={['/cart']}>
            <Routes>
                <Route path="/cart" element={<Cart />} />
                <Route path="/login" element={<SignInProbe />} />
            </Routes>
        </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: /Sign in to check out/ }));

    const state = JSON.parse((await screen.findByTestId('login-state')).textContent);
    expect(state).toEqual({ from: { pathname: '/cart', search: '' } });
});
