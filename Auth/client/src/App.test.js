import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// index.js supplies a BrowserRouter; MemoryRouter stands in for it here.
test('renders the AuthShield landing page at /', () => {
    render(
        <MemoryRouter initialEntries={['/']}>
            <App />
        </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Ship secure API access/ })).toBeInTheDocument();
});
