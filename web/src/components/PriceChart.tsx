import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { formatAmount, formatExact, formatTimestamp } from '../format';
import type { SnapshotPoint } from '../snapshots';
import { AddressLink } from './AddressLink';

interface Props {
  points: SnapshotPoint[];
  /** Current live share price and the time it was read, drawn as a hollow end marker. */
  live?: { price: bigint; timestamp: bigint };
  assetSymbol: string;
  assetDecimals: number;
  shareSymbol: string;
  shareDecimals: number;
  txUrl: (hash: string) => string;
  loading: boolean;
  error?: string;
  progress?: { scanned: bigint; total: bigint };
}

interface Plotted {
  x: number;
  y: number;
  t: number;
  price: bigint;
  point?: SnapshotPoint;
}

const HEIGHT = 240;
const PAD = { top: 16, right: 20, bottom: 36, left: 56 };

/**
 * Width of the plot container. A callback ref is used because the plot mounts only once
 * data exists, after the component's first render.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(640);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth || 640);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 1e6; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFormatWithTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PriceChart(props: Props) {
  const { points, live, assetSymbol, assetDecimals, shareSymbol, shareDecimals, txUrl, loading, error, progress } = props;
  const [wrapRef, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();

  const plotted = useMemo(() => {
    const all: { t: number; price: bigint; point?: SnapshotPoint }[] = points.map((p) => ({ t: Number(p.timestamp), price: p.price, point: p }));
    if (live) all.push({ t: Number(live.timestamp), price: live.price });
    if (all.length === 0) {
      return { data: [] as Plotted[], yTicks: [] as { v: number; y: number }[], xTicks: [] as { x: number; label: string }[], innerW: 0 };
    }
    const innerW = Math.max(width - PAD.left - PAD.right, 40);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const ts = all.map((p) => p.t);
    const prices = all.map((p) => Number(formatUnits(p.price, assetDecimals)));
    let tMin = Math.min(...ts);
    let tMax = Math.max(...ts);
    if (tMax === tMin) {
      tMin -= 3600;
      tMax += 3600;
    }
    let pMin = Math.min(...prices);
    let pMax = Math.max(...prices);
    if (pMax === pMin) {
      pMin = pMin * 0.98;
      pMax = pMax * 1.02 || 1;
    }
    const yTicks = niceTicks(pMin, pMax);
    const yLo = Math.min(pMin, yTicks[0] ?? pMin);
    const yHi = Math.max(pMax, yTicks[yTicks.length - 1] ?? pMax);
    const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - yLo) / (yHi - yLo || 1)) * innerH;
    const data: Plotted[] = all.map((p, i) => ({ x: x(p.t), y: y(prices[i] ?? 0), t: p.t, price: p.price, ...(p.point ? { point: p.point } : {}) }));
    const tickCount = Math.max(2, Math.min(5, Math.floor(innerW / 120)));
    const xTicks = Array.from({ length: tickCount }, (_, i) => {
      const t = tMin + ((tMax - tMin) * i) / (tickCount - 1);
      const spanDays = (tMax - tMin) / 86400;
      return { x: x(t), label: (spanDays < 2 ? timeFormatWithTime : timeFormat).format(new Date(t * 1000)) };
    });
    return { data, yTicks: yTicks.map((v) => ({ v, y: y(v) })), xTicks, innerW };
  }, [points, live, width, assetDecimals]);

  const data = plotted.data;
  const snapshotData = data.filter((d) => d.point);
  const linePath = snapshotData.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ');
  const last = snapshotData[snapshotData.length - 1];
  const livePoint = live ? data[data.length - 1] : undefined;

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    data.forEach((d, i) => {
      const dist = Math.abs(d.x - px);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    return best;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (data.length === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => {
        const cur = a ?? data.length - 1;
        return e.key === 'ArrowRight' ? Math.min(cur + 1, data.length - 1) : Math.max(cur - 1, 0);
      });
    } else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(data.length - 1);
    else if (e.key === 'Escape') setActive(null);
  };

  const activePoint = active !== null ? data[active] : undefined;
  const priceText = (p: bigint) => `${formatAmount(p, assetDecimals, 6)} ${assetSymbol}`;
  const summary =
    points.length === 0
      ? 'No snapshots recorded yet.'
      : `${points.length} snapshot${points.length === 1 ? '' : 's'}; latest ${priceText(points[points.length - 1]?.price ?? 0n)} per ${shareSymbol}.`;

  return (
    <figure className="chart" aria-labelledby={titleId} aria-describedby={descId}>
      <figcaption>
        <h3 id={titleId}>Share price at vault actions</h3>
        <p id={descId} className="muted">
          {assetSymbol} per 1 {shareSymbol}, from every Snapshot event the vault emitted. Passive vesting between actions is not recorded; the hollow
          marker is the current live price. {summary}
        </p>
      </figcaption>

      {error ? (
        <p className="inline-error" role="alert">
          Unable to load the price history. {error}
        </p>
      ) : null}
      {loading ? (
        <p className="muted small" role="status">
          Scanning vault events{progress ? ` (${Number((progress.scanned * 100n) / (progress.total || 1n))}%)` : ''}…
        </p>
      ) : null}

      {points.length === 0 && !loading ? (
        <div className="empty">
          <p>
            <strong>No price history yet</strong>
          </p>
          <p className="muted">The first deposit, redemption or donation records the first snapshot.</p>
        </div>
      ) : null}

      {points.length > 0 ? (
        <div
          ref={wrapRef}
          className="chart-plot"
          tabIndex={0}
          role="group"
          aria-label={`Share price chart. Use Left and Right arrow keys to move between ${data.length} points.`}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            aria-hidden="true"
            onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          >
            {plotted.yTicks.map((t) => (
              <g key={t.v}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} />
                <text className="axis" x={PAD.left - 8} y={t.y + 4} textAnchor="end">
                  {t.v.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </text>
              </g>
            ))}
            {plotted.xTicks.map((t, i) => (
              <text key={i} className="axis" x={t.x} y={HEIGHT - PAD.bottom + 20} textAnchor={i === 0 ? 'start' : i === plotted.xTicks.length - 1 ? 'end' : 'middle'}>
                {t.label}
              </text>
            ))}
            <line className="axis-line" x1={PAD.left} x2={width - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} />
            {linePath ? <path className="series-line" d={linePath} /> : null}
            {last && livePoint ? <line className="series-live" x1={last.x} y1={last.y} x2={livePoint.x} y2={livePoint.y} /> : null}
            {activePoint ? <line className="crosshair" x1={activePoint.x} x2={activePoint.x} y1={PAD.top} y2={HEIGHT - PAD.bottom} /> : null}
            {snapshotData.map((d, i) => (
              <circle key={i} className={`marker ${activePoint === d ? 'marker-active' : ''}`} cx={d.x} cy={d.y} r={4} />
            ))}
            {livePoint ? <circle className={`marker marker-live ${activePoint === livePoint ? 'marker-active' : ''}`} cx={livePoint.x} cy={livePoint.y} r={4.5} /> : null}
          </svg>
          {activePoint ? (
            <div
              className="tooltip num"
              role="status"
              style={{ insetInlineStart: Math.min(Math.max(activePoint.x - 90, 0), Math.max(width - 190, 0)), top: 4 }}
            >
              <strong>{priceText(activePoint.price)}</strong>
              <span className="muted">
                {activePoint.point ? formatTimestamp(activePoint.point.timestamp) : `Live · ${formatTimestamp(activePoint.t)}`}
              </span>
            </div>
          ) : (
            <div className="tooltip tooltip-hidden" role="status" aria-hidden="true" />
          )}
        </div>
      ) : null}

      {points.length > 0 ? (
        <details className="table-details">
          <summary>Show snapshots as a table</summary>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Snapshot events with total assets, total supply and implied share price</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col" className="num-col">
                    Total assets ({assetSymbol})
                  </th>
                  <th scope="col" className="num-col">
                    Total shares ({shareSymbol})
                  </th>
                  <th scope="col" className="num-col">
                    Price ({assetSymbol}/{shareSymbol})
                  </th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={`${p.transactionHash}-${p.logIndex}`}>
                    <td>{formatTimestamp(p.timestamp)}</td>
                    <td className="num num-col" title={formatExact(p.totalAssets, assetDecimals)}>
                      {formatAmount(p.totalAssets, assetDecimals)}
                    </td>
                    <td className="num num-col" title={formatExact(p.totalSupply, shareDecimals)}>
                      {formatAmount(p.totalSupply, shareDecimals)}
                    </td>
                    <td className="num num-col" title={formatExact(p.price, assetDecimals)}>
                      {formatAmount(p.price, assetDecimals, 6)}
                    </td>
                    <td>
                      <AddressLink href={txUrl(p.transactionHash)} value={p.transactionHash} kind="tx" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
