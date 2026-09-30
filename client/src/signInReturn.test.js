// Returning the shopper to where they were after signing in.
import {
    safeReturnPath,
    signInState,
    finishSignIn,
    rememberSignInReturn,
    peekSignInReturn,
    takeSignInReturn
} from './utils';

describe('safeReturnPath', () => {
    test('keeps a page inside the app, with its query string', () => {
        expect(safeReturnPath({ pathname: '/product/walmart/7', search: '?ref=home' }))
            .toBe('/product/walmart/7?ref=home');
        expect(safeReturnPath({ pathname: '/cart', search: '' })).toBe('/cart');
    });

    test('refuses anything off-site, the sign-in screens themselves, and the admin area', () => {
        ['https://evil.example', '//evil.example', '/login', '/signup', '/verify-signup',
            '/forgotpassword', '/auth/google/callback', '/admin/users', ''].forEach((pathname) => {
            expect(safeReturnPath({ pathname, search: '' })).toBeNull();
        });
        expect(safeReturnPath(null)).toBeNull();
        expect(safeReturnPath({ pathname: 42 })).toBeNull();
    });

    test('signInState records the current page and an optional action', () => {
        expect(signInState({ pathname: '/cart', search: '' })).toEqual({ from: { pathname: '/cart', search: '' } });
        expect(signInState({ pathname: '/product/amazon/3', search: '' }, { action: 'buyNow', quantity: 2 }))
            .toEqual({ from: { pathname: '/product/amazon/3', search: '' }, resume: { action: 'buyNow', quantity: 2 } });
    });
});

describe('finishSignIn', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        delete global.fetch;
    });

    test('goes back to the page, handing over the action to resume', async () => {
        const navigate = jest.fn();
        await finishSignIn(navigate, {
            from: { pathname: '/product/walmart/7', search: '' },
            resume: { action: 'buyNow', quantity: 2 }
        });
        expect(navigate).toHaveBeenCalledWith('/product/walmart/7', {
            replace: true,
            state: { resume: { action: 'buyNow', quantity: 2 } }
        });
    });

    test('falls back to /home with no target, or an unsafe one', async () => {
        const navigate = jest.fn();
        await finishSignIn(navigate, undefined);
        await finishSignIn(navigate, { from: { pathname: '//evil.example' } });
        expect(navigate).toHaveBeenNthCalledWith(1, '/home', { replace: true });
        expect(navigate).toHaveBeenNthCalledWith(2, '/home', { replace: true });
    });

    test('moves the guest cart into the account before leaving', async () => {
        localStorage.setItem('guestCart', JSON.stringify([
            { productName: 'Eggs', productQuantity: 1, productPrice: 2.99, source: 'amazon', providerProductId: '1' }
        ]));
        const order = [];
        global.fetch = jest.fn(async (url) => {
            order.push(String(url));
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                clone() { return this; },
                json: async () => ({ success: true, csrfToken: 'test-csrf' })
            };
        });
        const navigate = jest.fn(() => order.push('navigate'));

        await finishSignIn(navigate, { from: { pathname: '/cart', search: '' } });

        expect(order.some((u) => u.endsWith('/cart/add'))).toBe(true);
        expect(order[order.length - 1]).toBe('navigate');
        expect(navigate).toHaveBeenCalledWith('/cart', { replace: true, state: null });
        expect(localStorage.getItem('guestCart')).toBeNull();
    });
});

describe('surviving the Google round trip', () => {
    beforeEach(() => sessionStorage.clear());

    test('remember, then peek (kept), then take (cleared)', () => {
        const target = { from: { pathname: '/cart', search: '' } };
        rememberSignInReturn(target);
        expect(peekSignInReturn()).toEqual(target);
        expect(peekSignInReturn()).toEqual(target);
        expect(takeSignInReturn()).toEqual(target);
        expect(peekSignInReturn()).toBeNull();
    });

    test('starting a sign-in with nowhere to return clears an old target', () => {
        rememberSignInReturn({ from: { pathname: '/cart', search: '' } });
        rememberSignInReturn(null);
        expect(peekSignInReturn()).toBeNull();

        rememberSignInReturn({ from: { pathname: '/cart', search: '' } });
        rememberSignInReturn({ from: { pathname: 'https://evil.example' } });
        expect(peekSignInReturn()).toBeNull();
    });
});
