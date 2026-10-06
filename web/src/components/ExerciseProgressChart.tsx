import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export type ChartPoint = { key: string; date: string; value: number | null };

/// A line progress chart for exercise tracking. Renders a progression curve with gradient fill
/// and interactive session inspection. When points have unknown values, they render honestly
/// without interpolating fictitious numbers.
export function ExerciseProgressChart({ points, label, format }: {
  points: ChartPoint[];
  label: string;
  format: (value: number | null) => string;
}) {
  const gradientId = useId();
  const [selected, setSelected] = useState<number | null>(null);

  if (!points.length) {
    return <div className="exercise-chart"><span className="muted">No completed working sets in this range.</span></div>;
  }
  if (!points.some(point => point.value !== null)) {
    return <div className="exercise-chart"><span className="muted">No logged weights in this range to calculate {label.replace(/\s+progress$/i, '').toLowerCase()}.</span></div>;
  }

  let defaultIndex = points.length - 1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== null) {
      defaultIndex = i;
      break;
    }
  }
  const index = selected === null || selected >= points.length ? defaultIndex : selected;
  const current = points[index];

  const validValues = points.map(p => p.value).filter((v): v is number => v !== null);
  const minVal = Math.min(...validValues);
  const maxVal = Math.max(...validValues);
  const valSpread = maxVal === minVal ? Math.max(1, maxVal * 0.2) : maxVal - minVal;
  const yMin = maxVal === minVal ? Math.max(0, minVal - valSpread) : Math.max(0, minVal - valSpread * 0.15);
  const yMax = maxVal === minVal ? minVal + valSpread : maxVal + valSpread * 0.15;
  const range = Math.max(1e-6, yMax - yMin);

  const width = 600;
  const height = 150;
  const padLeft = 24;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const baselineY = height - padBottom;

  const count = points.length;
  function getX(i: number) {
    if (count <= 1) return width / 2;
    return padLeft + (i / (count - 1)) * plotWidth;
  }

  function getY(v: number | null) {
    if (v === null) return null;
    const norm = (v - yMin) / range;
    return baselineY - norm * plotHeight;
  }

  const coords = points.map((p, i) => ({
    x: getX(i),
    y: getY(p.value),
    value: p.value
  }));

  const validCoords = coords.filter((c): c is { x: number; y: number; value: number } => c.y !== null);

  let linePath = '';
  let areaPath = '';

  if (validCoords.length > 1) {
    linePath = `M ${validCoords[0].x} ${validCoords[0].y}`;
    for (let i = 1; i < validCoords.length; i++) {
      linePath += ` L ${validCoords[i].x} ${validCoords[i].y}`;
    }
    const first = validCoords[0];
    const last = validCoords[validCoords.length - 1];
    areaPath = `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
  }

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(0.999, (event.clientX - box.left) / box.width));
    setSelected(Math.floor(ratio * points.length));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(Math.min(points.length - 1, Math.max(0, next)));
  }

  const activeCoord = coords[index];
  const showAxis = points.length > 1 && points[0].date !== points[points.length - 1].date;

  return (
    <div className="exercise-chart">
      <p className="exercise-chart-readout" aria-live="polite">
        <strong>{format(current.value)}</strong>
        <span>{current.date}</span>
      </p>
      <div
        className="exercise-chart-bars exercise-chart-canvas"
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
        <svg
          className="exercise-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <line x1={padLeft} y1={padTop + plotHeight * 0.25} x2={width - padRight} y2={padTop + plotHeight * 0.25} stroke="var(--border)" strokeDasharray="4 4" strokeWidth="1" opacity="0.6" />
          <line x1={padLeft} y1={padTop + plotHeight * 0.5} x2={width - padRight} y2={padTop + plotHeight * 0.5} stroke="var(--border)" strokeDasharray="4 4" strokeWidth="1" opacity="0.6" />
          <line x1={padLeft} y1={padTop + plotHeight * 0.75} x2={width - padRight} y2={padTop + plotHeight * 0.75} stroke="var(--border)" strokeDasharray="4 4" strokeWidth="1" opacity="0.6" />
          <line x1={padLeft} y1={baselineY} x2={width - padRight} y2={baselineY} stroke="var(--border)" strokeWidth="1" opacity="0.75" />

          {validCoords.length === 1 && (
            <line
              x1={padLeft}
              y1={validCoords[0].y}
              x2={width - padRight}
              y2={validCoords[0].y}
              stroke="var(--accent)"
              strokeDasharray="4 4"
              strokeWidth="1.5"
              opacity="0.35"
            />
          )}

          {areaPath && (
            <path d={areaPath} fill={`url(#${gradientId})`} />
          )}

          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {activeCoord && (
            <line
              x1={activeCoord.x}
              y1={padTop}
              x2={activeCoord.x}
              y2={baselineY}
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              opacity="0.75"
            />
          )}

          {coords.map((c, i) => {
            if (c.y === null || i === index) return null;
            return (
              <circle
                key={points[i].key}
                cx={c.x}
                cy={c.y}
                r="4"
                fill="var(--surface-raised)"
                stroke="var(--accent)"
                strokeWidth="2"
              />
            );
          })}

          {activeCoord && activeCoord.y !== null && (
            <g>
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="9"
                fill="var(--accent-soft)"
              />
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="5"
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </g>
          )}

          {coords.map((c, i) => {
            if (c.y !== null) return null;
            return (
              <circle
                key={points[i].key}
                cx={c.x}
                cy={baselineY}
                r="3"
                fill="transparent"
                stroke="var(--faint)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
            );
          })}
        </svg>
      </div>
      {showAxis && (
        <div className="exercise-chart-axis" aria-hidden="true">
          <span>{points[0].date}</span>
          <span>{points[points.length - 1].date}</span>
        </div>
      )}
    </div>
  );
}
