import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import PriceAdvisorWidget, { describePriceStats } from './PriceAdvisorWidget';
import { fetchPriceAdvice } from '../utils';

jest.mock('../utils', () => ({
    ...jest.requireActual('../utils'),
    fetchPriceAdvice: jest.fn()
}));

const JARGON = /percentile|median|snapshot|data point|\b30d\b|buy\/wait/i;
const SEP_1 = '2026-09-01T00:00:00.000Z';

const stats = (overrides) => ({
    sampleCount: 5,
    current: 14.99,
    min: 12.99,
    max: 19.99,
    percentile: 50,
    trend30dPct: 0,
    firstSnapshotAt: SEP_1,
    ...overrides
});

const words = (phrases) => phrases.map((p) => p.strong + p.rest).join(' · ');

describe('describePriceStats', () => {
    test('says nothing until there are at least three prices', () => {
        expect(describePriceStats(null)).toBeNull();
        expect(describePriceStats(stats({ sampleCount: 2 }))).toBeNull();
    });

    test('a price that never moved reads as unchanged, not as the cheapest', () => {
        expect(words(describePriceStats(stats({ min: 14.99, max: 14.99, percentile: 0 }))))
            .toBe('No price change since Sep 1');
    });

    test('the lowest price, down since tracking began', () => {
        expect(words(describePriceStats(stats({ current: 12.99, percentile: 0, trend30dPct: -25 }))))
            .toBe("Lowest price we've seen in the last 30 days · Down 25% since Sep 1");
    });

    test('the highest price, up since tracking began', () => {
        expect(words(describePriceStats(stats({ current: 19.99, percentile: 100, trend30dPct: 8 }))))
            .toBe("Highest price we've seen in the last 30 days · Up 8% since Sep 1");
    });

    test('near either end, and in the middle', () => {
        expect(describePriceStats(stats({ current: 13.5, percentile: 10 }))[0].strong).toBe('Close to the lowest price');
        expect(describePriceStats(stats({ current: 19, percentile: 90 }))[0].strong).toBe('Close to the highest price');
        expect(words(describePriceStats(stats({ percentile: 50, trend30dPct: 0 }))))
            .toBe('About the usual price for the last 30 days · Same price as on Sep 1');
    });

    test('no phrase ever uses statistics jargon', () => {
        const cases = [
            stats({ min: 14.99, max: 14.99 }),
            stats({ current: 12.99, percentile: 0, trend30dPct: -25 }),
            stats({ current: 19.99, percentile: 100, trend30dPct: 8 }),
            stats({ percentile: 50 })
        ];
        cases.forEach((s) => expect(words(describePriceStats(s))).not.toMatch(JARGON));
    });
});

describe('PriceAdvisorWidget', () => {
    afterEach(() => fetchPriceAdvice.mockReset());

    test('the early-days case shows only the plain sentence, with no stats line', async () => {
        fetchPriceAdvice.mockResolvedValue({
            ok: true,
            success: true,
            advice: "We've only just started watching this price — it's $14.99 so far. Check back in a few days and we'll tell you whether it's a good time to buy.",
            stats: stats({ sampleCount: 2, current: 14.99, min: 14.99, max: 14.99, percentile: 0 })
        });
        const { container } = render(<PriceAdvisorWidget provider="amazon" productId="p1" />);

        await screen.findByText(/only just started watching this price/);
        expect(screen.getByText("Based on this item's prices over the last 30 days")).toBeInTheDocument();
        expect(container.textContent).not.toMatch(JARGON);
    });

    test('with enough history, the stats line is in plain words', async () => {
        fetchPriceAdvice.mockResolvedValue({
            ok: true,
            success: true,
            advice: 'Now is a good time to buy — it is the lowest price in the last 30 days.',
            stats: stats({ current: 12.99, percentile: 0, trend30dPct: -25 })
        });
        const { container } = render(<PriceAdvisorWidget provider="amazon" productId="p2" />);

        await screen.findByText('Lowest price');
        expect(screen.getByText('Down 25%')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(JARGON);
    });
});
