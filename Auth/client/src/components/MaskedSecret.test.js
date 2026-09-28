import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaskedSecret from './MaskedSecret';

const SECRET = 'auth_sk_live_example_not_a_real_secret';

test('hides the value behind dots until the eye button is pressed', async () => {
    const user = userEvent.setup();
    render(<MaskedSecret value={SECRET} label="Client Secret" />);

    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.getByText(/^•+$/)).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show Client Secret' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Client Secret' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide Client Secret' }));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
});

test('the mask does not reveal the secret length', () => {
    const { rerender } = render(<MaskedSecret value="short" />);
    const shortMask = screen.getByText(/^•+$/).textContent;

    rerender(<MaskedSecret value={SECRET.repeat(3)} />);
    expect(screen.getByText(/^•+$/).textContent).toBe(shortMask);
});
