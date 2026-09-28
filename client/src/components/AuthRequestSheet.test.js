import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthRequestSheet from './AuthRequestSheet';

const renderSheet = (open = true) =>
    render(
        <MemoryRouter>
            <AuthRequestSheet open={open} onClose={() => {}} />
        </MemoryRouter>
    );

test('the client secret is typed as dots, and the eye button toggles it', async () => {
    const user = userEvent.setup();
    renderSheet();

    const secret = screen.getByLabelText('Client secret');
    await user.type(secret, 'auth_sk_live_example');
    expect(secret).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show client secret' }));
    expect(secret).toHaveAttribute('type', 'text');
    expect(secret).toHaveValue('auth_sk_live_example');

    await user.click(screen.getByRole('button', { name: 'Hide client secret' }));
    expect(secret).toHaveAttribute('type', 'password');
});

test('reopening the dialog starts masked again', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();

    await user.click(screen.getByRole('button', { name: 'Show client secret' }));
    expect(screen.getByLabelText('Client secret')).toHaveAttribute('type', 'text');

    const sheet = (open) => (
        <MemoryRouter>
            <AuthRequestSheet open={open} onClose={() => {}} />
        </MemoryRouter>
    );
    rerender(sheet(false));
    rerender(sheet(true));

    expect(screen.getByLabelText('Client secret')).toHaveAttribute('type', 'password');
});
