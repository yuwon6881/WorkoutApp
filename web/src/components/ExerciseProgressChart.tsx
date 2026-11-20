import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { chartScale, nearestPointIndex, pointPositions, tickLabel } from '../lib/progressChart';
import { Button } from './ui/Button';

type ChartPoint = {
  key: string; date: string; value: number | null;
  missingDetail?: { set: string | null; reason: string; hasVolume: boolean };
};

const height = 176;
const padLeft = 40;
const padRight = 18;
const padTop = 14;
const padBottom = 30;
const fallbackWidth = 600;

/// A line progress chart for exercise tracking. It draws at the canvas's real pixel width so dots
/// stay round, and every dot is selectable by pointer (the nearest dot to the pointer) or by arrow
/// keys. Sessions without a value break the line rather than interpolating a fictitious number.
export function ExerciseProgressChart({ points, label, format, missingLabel = 'No value for this workout',
  missingMessage = 'No values are available for this metric in this range.', onViewVolume }: {
  points: ChartPoint[];
  label: string;
  format: (value: number | null) => string;
  missingLabel?: string;
  missingMessage?: string;
  onViewVolume?: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallbackWidth);
  const [selected, setSelected] = useState<string | null>(null);
  const known = points.filter(point => point.value !== null);
  const hasTrend = known.length > 1;

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasTrend]);

  if (!points.length) {
    return <div className="exercise-chart"><span className="muted">No completed working sets in this range.</span></div>;
  }
  const latestKnown = known.at(-1);
  const selectedIndex = selected === null ? -1 : points.findIndex(point => point.key === selected);
  const index = selectedIndex >= 0 ? selectedIndex : latestKnown ? points.lastIndexOf(latestKnown) : points.length - 1;
  const current = points[index];
  const currentValue = current.value === null ? missingLabel : format(current.value);

  const scale = chartScale(hasTrend ? known.map(point => point.value!) : [0]);
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
    setSelected(points[nearestPointIndex(xs, ((event.clientX - box.left) / box.width) * width)].key);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectAt(next);
  }

  function selectAt(next: number) {
    if (next >= 0 && next < points.length) setSelected(points[next].key);
  }

  const lastIndex = points.length - 1;
  const showRange = points.length > 1 && points[0].date !== points[lastIndex].date;
  const activeX = xs[index];
  const activeY = current.value === null ? null : y(current.value);

  return (
    <div className="exercise-chart">
      <div className="exercise-chart-header">
        <div className="exercise-chart-readout" aria-live="polite" aria-atomic="true">
          <span>{current.date}</span>
          <span className="exercise-chart-position">Workout {index + 1} of {points.length}</span>
        </div>
        {points.length > 1 && <div className="exercise-chart-nav" role="group" aria-label="Browse workouts">
          <Button aria-label="Previous workout" title="Previous workout" aria-disabled={index === 0} onClick={() => selectAt(index - 1)}>
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <Button aria-label="Next workout" title="Next workout" aria-disabled={index === lastIndex} onClick={() => selectAt(index + 1)}>
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>}
      </div>
      <div className="exercise-chart-value" ref={readout} tabIndex={-1} aria-live="polite" aria-atomic="true">
        <strong>{currentValue}</strong>
        <span>{current.value === null ? 'Workout recorded' : label.replace(/ progress$/, '')}</span>
      </div>
      {hasTrend && <div
        ref={canvas}
        className="exercise-chart-canvas"
        role="slider"
        tabIndex={0}
        aria-label={`${label}, session ${index + 1} of ${points.length}`}
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={index + 1}
        aria-valuetext={`${current.date}: ${currentValue}`}
        onPointerDown={pick}
        onPointerMove={event => { if (event.pointerType === 'mouse' && event.buttons === 1) pick(event); }}
        onKeyDown={step}
      >
        <svg className="exercise-chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {scale.ticks.map(tick => (
            <g key={tick}>
              <line className="exercise-chart-grid" x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} />
              <text className="exercise-chart-tick" x={padLeft - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tickLabel(tick)}</text>
            </g>
          ))}

          {points.length > 1 && <line className="exercise-chart-guide" x1={activeX} x2={activeX} y1={padTop} y2={baselineY} />}

          {segments.map(segment => segment.length > 1 && (
            <path key={`${segment[0].x}`} className="exercise-chart-line" d={`M ${segment.map(p => `${p.x} ${p.y}`).join(' L ')}`} />
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
      </div>}
      {!known.length && <p className="exercise-chart-note muted">{missingMessage}</p>}
      {!hasTrend && latestKnown && current.value === null && <p className="exercise-chart-note muted">
        Only value in this range: {format(latestKnown.value)} · {latestKnown.date}
      </p>}
      {current.missingDetail && <div className="exercise-chart-detail">
        <div aria-live="polite">
          {current.missingDetail.set && <p className="exercise-chart-note"><strong>{current.missingDetail.set}</strong></p>}
          <p className="exercise-chart-note muted">{current.missingDetail.reason}</p>
        </div>
        {current.missingDetail.hasVolume && onViewVolume && <Button variant="tertiary" onClick={() => {
          onViewVolume();
          readout.current?.focus({ preventScroll: true });
        }}>View volume</Button>}
      </div>}
    </div>
  );
}
