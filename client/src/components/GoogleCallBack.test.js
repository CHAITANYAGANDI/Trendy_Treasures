import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GoogleCallBack from './GoogleCallBack';
import { apiFetch, peekSignInReturn, rememberSignInReturn } from '../utils';

jest.mock('../utils', () => ({ ...jest.requireActual('../utils'), apiFetch: jest.fn() }));

const renderCallback = () =>
    render(
        <MemoryRouter initialEntries={['/auth/google/callback']}>
            <Routes>
                <Route path="/auth/google/callback" element={<GoogleCallBack />} />
                <Route path="/cart" element={<p>Cart page</p>} />
                <Route path="/home" element={<p>Home page</p>} />
            </Routes>
        </MemoryRouter>
    );

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

test('a Google sign-in returns to the page parked before leaving, then forgets it', async () => {
    rememberSignInReturn({ from: { pathname: '/cart', search: '' } });
    renderCallback();

    expect(await screen.findByText('Cart page')).toBeInTheDocument();
    expect(peekSignInReturn()).toBeNull();
});

test('with nothing parked it lands on home, as before', async () => {
    renderCallback();

    expect(await screen.findByText('Home page')).toBeInTheDocument();
});
