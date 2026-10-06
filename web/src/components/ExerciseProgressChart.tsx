import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { chartScale, nearestPointIndex, pointPositions, tickLabel } from '../lib/progressChart';

export type ChartPoint = { key: string; date: string; value: number | null };

const height = 176;
const padLeft = 40;
const padRight = 18;
const padTop = 14;
const padBottom = 30;
const fallbackWidth = 600;

/// A line progress chart for exercise tracking. It draws at the canvas's real pixel width so dots
/// stay round, and every dot is selectable by pointer (the nearest dot to the pointer) or by arrow
/// keys. Sessions without a value break the line rather than interpolating a fictitious number.
export function ExerciseProgressChart({ points, label, format }: {
  points: ChartPoint[];
  label: string;
  format: (value: number | null) => string;
}) {
  const gradientId = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallbackWidth);
  const [selected, setSelected] = useState<number | null>(null);
  const hasValues = points.some(point => point.value !== null);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasValues]);

  if (!points.length) {
    return <div className="exercise-chart"><span className="muted">No completed working sets in this range.</span></div>;
  }
  if (!hasValues) {
    return <div className="exercise-chart"><span className="muted">No logged weights in this range to calculate {label.replace(/\s+progress$/i, '').toLowerCase()}.</span></div>;
  }

  let latestKnown = points.length - 1;
  while (latestKnown > 0 && points[latestKnown].value === null) latestKnown--;
  const index = selected === null || selected >= points.length ? latestKnown : selected;
  const current = points[index];

  const scale = chartScale(points.flatMap(point => point.value === null ? [] : [point.value]));
  const baselineY = height - padBottom;
  const plotHeight = baselineY - padTop;
  const xs = pointPositions(points.length, padLeft, width - padRight);
  const y = (value: number) => baselineY - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;

  // Consecutive known values form one segment; a session without a value ends it.
  const segments: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((point, i) => {
    if (point.value === null) {
      if (run.length) segments.push(run);
      run = [];
    } else {
      run.push({ x: xs[i], y: y(point.value) });
    }
  });
  if (run.length) segments.push(run);

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setSelected(nearestPointIndex(xs, ((event.clientX - box.left) / box.width) * width));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(Math.min(points.length - 1, Math.max(0, next)));
  }

  const lastIndex = points.length - 1;
  const showRange = points.length > 1 && points[0].date !== points[lastIndex].date;
  const activeX = xs[index];
  const activeY = current.value === null ? null : y(current.value);

  return (
    <div className="exercise-chart">
      <p className="exercise-chart-readout" aria-live="polite">
        <strong>{format(current.value)}</strong>
        <span>{current.date}</span>
        {points.length > 1 && <span className="exercise-chart-position">Session {index + 1} of {points.length}</span>}
      </p>
      <div
        ref={canvas}
        className="exercise-chart-canvas"
        role="slider"
        tabIndex={0}
        aria-label={`${label}, session ${index + 1} of ${points.length}`}
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={index + 1}
        aria-valuetext={`${current.date}: ${format(current.value)}`}
        onPointerDown={pick}
        onPointerMove={event => { if (event.pointerType === 'mouse' || event.buttons) pick(event); }}
        onKeyDown={step}
      >
        <svg className="exercise-chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {scale.ticks.map(tick => (
            <g key={tick}>
              <line className="exercise-chart-grid" x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} />
              <text className="exercise-chart-tick" x={padLeft - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tickLabel(tick)}</text>
            </g>
          ))}

          {points.length > 1 && <line className="exercise-chart-guide" x1={activeX} x2={activeX} y1={padTop} y2={baselineY} />}

          {segments.map(segment => segment.length > 1 && (
            <g key={`${segment[0].x}`}>
              <path
                d={`M ${segment.map(p => `${p.x} ${p.y}`).join(' L ')} L ${segment[segment.length - 1].x} ${baselineY} L ${segment[0].x} ${baselineY} Z`}
                fill={`url(#${gradientId})`}
              />
              <path className="exercise-chart-line" d={`M ${segment.map(p => `${p.x} ${p.y}`).join(' L ')}`} />
            </g>
          ))}

          {points.map((point, i) => point.value === null
            ? <circle key={point.key} className="exercise-chart-gap" cx={xs[i]} cy={baselineY} r={3} />
            : i !== index && <circle key={point.key} className="exercise-chart-dot" cx={xs[i]} cy={y(point.value)} r={4} />)}

          {activeY !== null && <>
            <circle className="exercise-chart-halo" cx={activeX} cy={activeY} r={10} />
            <circle className="exercise-chart-dot active" cx={activeX} cy={activeY} r={5.5} />
          </>}

          {showRange ? <>
            <text className="exercise-chart-tick" x={xs[0]} y={height - 8} textAnchor="start">{points[0].date}</text>
            <text className="exercise-chart-tick" x={xs[lastIndex]} y={height - 8} textAnchor="end">{points[lastIndex].date}</text>
          </> : <text className="exercise-chart-tick" x={xs[lastIndex]} y={height - 8} textAnchor={points.length > 1 ? 'end' : 'middle'}>{points[lastIndex].date}</text>}
        </svg>
      </div>
    </div>
  );
}
