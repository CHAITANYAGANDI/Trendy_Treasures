import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ProductQAChat from './ProductQAChat';

test('opens with just the question box — no canned suggestion chips', () => {
    render(<ProductQAChat provider="walmart" productId="7" productName="Laptop" />);

    expect(screen.getByPlaceholderText('Ask anything about this product…')).toBeInTheDocument();
    ['Is this good for everyday use?', 'What materials is it made of?', 'Will this fit a small space?']
        .forEach((text) => expect(screen.queryByText(text)).not.toBeInTheDocument());
});
