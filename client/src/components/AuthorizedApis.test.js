import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthorizedApis from './AuthorizedApis';
import { apiFetch } from '../utils';

jest.mock('../utils', () => ({
    ...jest.requireActual('../utils'),
    apiFetch: jest.fn()
}));

const LONG_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.example-payload.example-signature-cjMg';
const SHORT_TOKEN = 'tok_short12';

const serveCredentials = (credentials) => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: credentials }) });
};

const renderTable = () =>
    render(
        <MemoryRouter>
            <AuthorizedApis onRequest={() => {}} />
        </MemoryRouter>
    );

afterEach(() => {
    apiFetch.mockReset();
});

test('access tokens are only dots until revealed — no leading or trailing characters', async () => {
    const user = userEvent.setup();
    serveCredentials([
        { _id: 'a', api_name: 'Amazon_Products', api_url: 'https://amazon.example', access_token: LONG_TOKEN }
    ]);
    renderTable();

    await screen.findByText('Amazon_Products');
    expect(screen.queryByText(/eyJhbG/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cjMg/)).not.toBeInTheDocument();
    expect(screen.getByText(/^•+$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show Amazon_Products token' }));
    expect(screen.getByText(LONG_TOKEN)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide Amazon_Products token' }));
    expect(screen.queryByText(LONG_TOKEN)).not.toBeInTheDocument();
});

test('short tokens are masked too, with the same number of dots', async () => {
    serveCredentials([
        { _id: 'a', api_name: 'Amazon_Products', api_url: 'https://a.example', access_token: LONG_TOKEN },
        { _id: 'w', api_name: 'Walmart', api_url: 'https://w.example', access_token: SHORT_TOKEN }
    ]);
    renderTable();

    await screen.findByText('Walmart');
    // Tokens of 12 characters or fewer used to be shown in full.
    expect(screen.queryByText(SHORT_TOKEN)).not.toBeInTheDocument();

    const masks = screen.getAllByText(/^•+$/).map((el) => el.textContent);
    expect(masks).toHaveLength(2);
    expect(masks[0]).toBe(masks[1]);
});
