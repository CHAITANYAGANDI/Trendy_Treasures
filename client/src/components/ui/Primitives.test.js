import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { Field } from './Primitives';

// `field-has-trailing` is what reserves room (index.css) so a long value
// ends before the trailing eye button instead of running underneath it.
test('a Field with a trailing control reserves room for it', () => {
    render(
        <Field
            id="secret"
            label="Client secret"
            value=""
            onChange={() => {}}
            trailing={<button type="button">eye</button>}
        />
    );
    expect(screen.getByLabelText('Client secret').parentElement).toHaveClass('field-has-trailing');
});

test('a plain Field keeps its normal padding', () => {
    render(<Field id="name" label="API name" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('API name').parentElement).not.toHaveClass('field-has-trailing');
});
