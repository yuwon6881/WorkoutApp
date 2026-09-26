import { useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export type ChartPoint = { key: string; date: string; value: number | null };

/// A progress chart that fits the screen it is on: bars share the full width instead of scrolling
/// sideways, only the first and last dates are printed, and touching, hovering or arrowing along
/// the chart reads out the exact value and date of the nearest session. The latest session is
/// read out first. Unknown values stay unknown and draw no bar.
export function ExerciseProgressChart({ points, label, format }: {
  points: ChartPoint[];
  label: string;
  format: (value: number | null) => string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!points.length) return <div className="exercise-chart"><span className="muted">No completed working sets in this range.</span></div>;

  const index = selected === null || selected >= points.length ? points.length - 1 : selected;
  const max = Math.max(1, ...points.map(point => point.value ?? 0));
  const current = points[index];

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
    setSelected(Math.floor(ratio * points.length));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(Math.min(points.length - 1, Math.max(0, next)));
  }

  return (
    <div className="exercise-chart">
      <p className="exercise-chart-readout" aria-live="polite">
        <strong>{format(current.value)}</strong>
        <span>{current.date}</span>
      </p>
      <div
        className="exercise-chart-bars"
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
        {points.map((point, pointIndex) => (
          <span
            key={point.key}
            className={`exercise-chart-point ${pointIndex === index ? 'selected' : ''} ${point.value === null ? 'unknown' : ''}`.trim()}
            aria-hidden="true"
          >
            {point.value !== null && <i style={{ height: `${Math.max(4, Math.min(100, (point.value / max) * 100))}%` }} />}
          </span>
        ))}
      </div>
      <div className="exercise-chart-axis" aria-hidden="true">
        <span>{points[0].date}</span>
        {points.length > 1 && <span>{points[points.length - 1].date}</span>}
      </div>
    </div>
  );
}
