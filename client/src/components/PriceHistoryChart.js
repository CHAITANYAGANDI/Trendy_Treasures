import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchPriceHistory } from '../utils';
import { Segmented, Spinner } from './ui/Primitives';

const RANGE_OPTIONS = [
    { id: 7, label: '7d' },
    { id: 30, label: '30d' },
    { id: 90, label: '90d' }
];

const fmtPrice = (n) => `$${Number(n).toFixed(2)}`;
const fmtDate = (d) => {
    const x = new Date(d);
    return `${x.toLocaleString('en-US', { month: 'short' })} ${x.getDate()}`;
};

// Renders an SVG line chart from a list of { price, snapshotted_at } points.
// Inline SVG is enough at this scale (≤365 points) and avoids pulling in
// Recharts/Chart.js (~80kB gzipped each) into the production bundle.
//
// The viewBox is measured from the container rather than fixed, because a
// fixed viewBox stretched inside a fluid column distorts the stroke weight
// and the axis type along with it.
function PriceHistoryChart({ provider, productId, currentPrice }) {
    const [days, setDays] = useState(30);
    const [snapshots, setSnapshots] = useState(null);
    const [loading, setLoading] = useState(true);
    const [width, setWidth] = useState(880);
    const frameRef = useRef(null);

    useLayoutEffect(() => {
        const node = frameRef.current;
        if (!node) return undefined;
        const measure = () => setWidth(Math.max(280, node.clientWidth));
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchPriceHistory(provider, productId, days).then((data) => {
            if (cancelled) return;
            setSnapshots(data || []);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [provider, productId, days]);

    const stats = useMemo(() => {
        if (!snapshots || snapshots.length === 0) return null;
        const prices = snapshots.map((s) => s.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const first = snapshots[0].price;
        const last = snapshots[snapshots.length - 1].price;
        const delta = last - first;
        const deltaPct = first > 0 ? (delta / first) * 100 : 0;
        return { min, max, first, last, delta, deltaPct };
    }, [snapshots]);

    // Geometry in measured pixels, so one SVG unit is always one CSS pixel.
    const geometry = useMemo(() => {
        if (!snapshots || snapshots.length === 0) return null;
        const W = width;
        const H = width < 560 ? 190 : width < 900 ? 250 : 300;
        const P = { t: 18, r: 14, b: 30, l: 54 };
        const innerW = W - P.l - P.r;
        const innerH = H - P.t - P.b;

        const prices = snapshots.map((s) => s.price);
        let minY = Math.min(...prices);
        let maxY = Math.max(...prices);
        // Pad the range so a perfectly flat history still renders mid-chart
        // and isolated highs/lows have visual headroom.
        if (minY === maxY) { minY = minY * 0.9; maxY = maxY * 1.1; }
        const padY = (maxY - minY) * 0.1;
        minY -= padY; maxY += padY;

        const firstT = new Date(snapshots[0].snapshotted_at).getTime();
        const lastT = new Date(snapshots[snapshots.length - 1].snapshotted_at).getTime();
        const spanT = Math.max(1, lastT - firstT);

        const x = (t) => P.l + ((new Date(t).getTime() - firstT) / spanT) * innerW;
        const y = (price) => P.t + (1 - (price - minY) / (maxY - minY)) * innerH;

        const points = snapshots.map((s) => ({ x: x(s.snapshotted_at), y: y(s.price), ...s }));
        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(P.t + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(P.t + innerH).toFixed(1)} Z`;

        // Y-axis gridlines + labels (3 ticks: min, mid, max in price space).
        const yTicks = [minY, (minY + maxY) / 2, maxY].map((v) => ({ value: v, y: y(v) }));

        return { W, H, P, innerW, innerH, points, linePath, areaPath, yTicks, firstT, lastT };
    }, [snapshots, width]);

    const fell = stats && stats.delta < 0;
    const rose = stats && stats.delta > 0;

    return (
        <section aria-labelledby="price-history-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 id="price-history-title" className="t-h2">Price history</h2>
                    <p className="t-ui dim mt-1">
                        Snapshots are taken when shoppers view this product.
                    </p>
                </div>
                <Segmented
                    options={RANGE_OPTIONS}
                    value={days}
                    onChange={setDays}
                    label="Price history range"
                />
            </div>

            <div ref={frameRef} className="mt-7">
                {loading ? (
                    <div className="h-[190px] md:h-[250px] flex flex-col items-center justify-center gap-3">
                        <Spinner size={24} />
                        <p className="t-ui dim">Loading price history…</p>
                    </div>
                ) : !snapshots || snapshots.length === 0 ? (
                    <div className="h-[190px] md:h-[250px] flex flex-col items-center justify-center text-center gap-2 border-t border-hairline">
                        <p className="t-h4">No price history yet.</p>
                        <p className="t-ui dim measure">
                            We'll start tracking the price{currentPrice ? ` (${fmtPrice(currentPrice)})` : ''} from this view onward.
                        </p>
                    </div>
                ) : (
                    <>
                        {geometry && (
                            <svg
                                viewBox={`0 0 ${geometry.W} ${geometry.H}`}
                                width={geometry.W}
                                height={geometry.H}
                                className="chart-svg"
                                role="img"
                                aria-label={`Price history line chart spanning ${days} days`}
                            >
                                <defs>
                                    <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#0071e3" stopOpacity="0.14" />
                                        <stop offset="100%" stopColor="#0071e3" stopOpacity="0" />
                                    </linearGradient>
                                </defs>

                                {/* Gridlines + Y labels */}
                                {geometry.yTicks.map((tick, i) => (
                                    <g key={i}>
                                        <line
                                            className="chart-grid"
                                            x1={geometry.P.l}
                                            x2={geometry.W - geometry.P.r}
                                            y1={tick.y}
                                            y2={tick.y}
                                        />
                                        <text
                                            className="chart-axis"
                                            x={geometry.P.l - 10}
                                            y={tick.y + 4}
                                            textAnchor="end"
                                        >
                                            {fmtPrice(tick.value)}
                                        </text>
                                    </g>
                                ))}

                                {/* X axis labels (first + last snapshot date) */}
                                <text className="chart-axis" x={geometry.P.l} y={geometry.H - 8}>
                                    {fmtDate(geometry.firstT)}
                                </text>
                                <text
                                    className="chart-axis"
                                    x={geometry.W - geometry.P.r}
                                    y={geometry.H - 8}
                                    textAnchor="end"
                                >
                                    {fmtDate(geometry.lastT)}
                                </text>

                                <path d={geometry.areaPath} fill="url(#priceArea)" />
                                <path
                                    key={`${days}-${geometry.W}`}
                                    d={geometry.linePath}
                                    className="chart-line chart-draw"
                                />

                                {/* Endpoint dot for emphasis on "current" price */}
                                {(() => {
                                    const last = geometry.points[geometry.points.length - 1];
                                    return <circle className="chart-dot" cx={last.x} cy={last.y} r="4.5" />;
                                })()}
                            </svg>
                        )}

                        {stats && (
                            <div className="figures mt-6">
                                <div>
                                    <p className="figure-l">Current</p>
                                    <p className="figure-v">{fmtPrice(stats.last)}</p>
                                </div>
                                <div>
                                    <p className="figure-l">{days}d low</p>
                                    <p className="figure-v">{fmtPrice(stats.min)}</p>
                                </div>
                                <div>
                                    <p className="figure-l">{days}d high</p>
                                    <p className="figure-v">{fmtPrice(stats.max)}</p>
                                </div>
                                <div>
                                    <p className="figure-l">Change</p>
                                    <p
                                        className={`figure-v ${fell ? 'figure-good' : rose ? 'figure-bad' : ''}`}
                                    >
                                        {stats.delta >= 0 ? '+' : ''}{fmtPrice(stats.delta)}{' '}
                                        <span className="text-ui font-normal">
                                            ({stats.deltaPct.toFixed(1)}%)
                                        </span>
                                    </p>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}

export default PriceHistoryChart;
