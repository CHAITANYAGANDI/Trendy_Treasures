import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import PriceHistoryChart from './PriceHistoryChart';
import { fetchPriceHistory } from '../utils';

jest.mock('../utils', () => ({ ...jest.requireActual('../utils'), fetchPriceHistory: jest.fn() }));

const at = (price, minutesAgo) => ({
    price,
    snapshotted_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
});
// The value printed under a figure's label ("Current", "30d low", …).
const figure = (label) => screen.getByText(label).nextElementSibling.textContent;
const wait = async (ms) => {
    await act(async () => {
        jest.advanceTimersByTime(ms);
    });
};

beforeEach(() => {
    jest.useFakeTimers();
    fetchPriceHistory.mockReset();
});

afterEach(() => {
    jest.useRealTimers();
});

test('when the first read beats the gateway write, one follow-up read shows the new price', async () => {
    fetchPriceHistory
        .mockResolvedValueOnce([at(1999.99, 60)])
        .mockResolvedValue([at(1999.99, 60), at(1599.99, 0)]);

    render(<PriceHistoryChart provider="walmart" productId="p1" currentPrice={1599.99} />);
    await waitFor(() => expect(figure('Current')).toBe('$1999.99'));

    await wait(1500);

    await waitFor(() => expect(figure('Current')).toBe('$1599.99'));
    // Computed from the real points, not hard-coded.
    expect(figure('30d low')).toBe('$1599.99');
    expect(figure('30d high')).toBe('$1999.99');
    expect(screen.getByText('Change').nextElementSibling).toHaveTextContent('(-20.0%)');
    expect(fetchPriceHistory).toHaveBeenCalledTimes(2);
});

test('history that already matches the page price is read once — no extra requests', async () => {
    fetchPriceHistory.mockResolvedValue([at(1999.99, 60), at(1599.99, 1)]);

    render(<PriceHistoryChart provider="walmart" productId="p2" currentPrice={1599.99} />);
    await waitFor(() => expect(figure('Current')).toBe('$1599.99'));
    await wait(10000);

    expect(fetchPriceHistory).toHaveBeenCalledTimes(1);
});

test('if the new point never arrives, it stops after two follow-ups instead of polling', async () => {
    fetchPriceHistory.mockResolvedValue([at(1999.99, 60)]);

    render(<PriceHistoryChart provider="amazon" productId="p3" currentPrice={1599.99} />);
    await waitFor(() => expect(figure('Current')).toBe('$1999.99'));
    await wait(1500);
    await wait(4000);
    await wait(30000);

    expect(fetchPriceHistory).toHaveBeenCalledTimes(3);
});

test('a first-ever view (no history yet) picks up the snapshot that view creates', async () => {
    fetchPriceHistory
        .mockResolvedValueOnce([])
        .mockResolvedValue([at(1599.99, 0)]);

    render(<PriceHistoryChart provider="walmart" productId="p4" currentPrice={1599.99} />);
    await waitFor(() => expect(fetchPriceHistory).toHaveBeenCalledTimes(1));
    await wait(1500);

    await waitFor(() => expect(figure('Current')).toBe('$1599.99'));
});

test('a failed read is not retried', async () => {
    fetchPriceHistory.mockResolvedValue(null);

    render(<PriceHistoryChart provider="walmart" productId="p5" currentPrice={1599.99} />);
    await waitFor(() => expect(fetchPriceHistory).toHaveBeenCalledTimes(1));
    await wait(10000);

    expect(fetchPriceHistory).toHaveBeenCalledTimes(1);
});
