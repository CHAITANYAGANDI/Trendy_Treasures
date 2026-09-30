import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ProductDetails from './ProductDetails';
import {
    fetchCurrentUser,
    walmartFetch,
    createCheckoutIntent,
    redirectToProviderCheckout,
    fetchPriceHistory,
    fetchPriceAdvice
} from '../utils';

jest.mock('../utils', () => ({
    ...jest.requireActual('../utils'),
    fetchCurrentUser: jest.fn(),
    walmartFetch: jest.fn(),
    apiFetch: jest.fn(async () => ({ ok: true, json: async () => ({ cartItems: [] }) })),
    createCheckoutIntent: jest.fn(),
    redirectToProviderCheckout: jest.fn(),
    fetchPriceHistory: jest.fn(),
    fetchPriceAdvice: jest.fn()
}));

const PRODUCT = {
    name: 'Apple MacBook Pro 14 Inch Space Grey',
    description: 'A laptop.',
    price: 1999.99,
    imageUrl: 'https://img.example/mbp.png',
    soldBy: 'Walmart',
    inStock: true,
    features: []
};

// Shows where the page sent the shopper, and with what state.
function SignInProbe() {
    const location = useLocation();
    return <pre data-testid="login-state">{JSON.stringify(location.state)}</pre>;
}

const renderProduct = (entry) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/product/:source/:productId" element={<ProductDetails />} />
                <Route path="/login" element={<SignInProbe />} />
            </Routes>
        </MemoryRouter>
    );

beforeEach(() => {
    localStorage.clear();
    walmartFetch.mockResolvedValue({ ok: true, json: async () => ({ product: PRODUCT }) });
    fetchPriceHistory.mockResolvedValue([]);
    fetchPriceAdvice.mockResolvedValue({ ok: false, status: 503, message: 'AI advice unavailable: unconfigured' });
    createCheckoutIntent.mockResolvedValue({ referralCode: 'TT-0123456789abcdef' });
    createCheckoutIntent.mockClear();
    redirectToProviderCheckout.mockClear();
});

test('signed out, "Buy now" sends the shopper to sign in, remembering the page and the purchase', async () => {
    const user = userEvent.setup();
    fetchCurrentUser.mockResolvedValue(null);
    renderProduct('/product/walmart/7');

    await user.click(await screen.findByRole('button', { name: /Buy now on Walmart/ }));

    const state = JSON.parse((await screen.findByTestId('login-state')).textContent);
    expect(state).toEqual({
        from: { pathname: '/product/walmart/7', search: '' },
        resume: { action: 'buyNow', quantity: 1 }
    });
    expect(createCheckoutIntent).not.toHaveBeenCalled();
});

test('back from sign-in, the purchase carries on to Walmart checkout with the chosen quantity', async () => {
    fetchCurrentUser.mockResolvedValue({ name: 'Shopper', email: 'shopper@example.com' });
    renderProduct({
        pathname: '/product/walmart/7',
        state: { resume: { action: 'buyNow', quantity: 2 } }
    });

    await waitFor(() => expect(redirectToProviderCheckout).toHaveBeenCalledWith('walmart', 'TT-0123456789abcdef'));
    expect(createCheckoutIntent).toHaveBeenCalledTimes(1);
    expect(createCheckoutIntent.mock.calls[0][0].items[0]).toMatchObject({ providerProductId: '7', quantity: 2 });
});

test('an ordinary visit never starts checkout on its own', async () => {
    fetchCurrentUser.mockResolvedValue({ name: 'Shopper', email: 'shopper@example.com' });
    renderProduct('/product/walmart/7');

    await screen.findByRole('button', { name: /Buy now on Walmart/ });
    expect(createCheckoutIntent).not.toHaveBeenCalled();
});

test('a resumed purchase is not started for an item that has gone out of stock', async () => {
    walmartFetch.mockResolvedValue({ ok: true, json: async () => ({ product: { ...PRODUCT, inStock: false } }) });
    fetchCurrentUser.mockResolvedValue({ name: 'Shopper', email: 'shopper@example.com' });
    renderProduct({ pathname: '/product/walmart/7', state: { resume: { action: 'buyNow', quantity: 1 } } });

    await screen.findByRole('button', { name: /Buy now on Walmart/ });
    expect(createCheckoutIntent).not.toHaveBeenCalled();
});
