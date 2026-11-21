import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { chartScale, downsampleChartPoints, nearestPointIndex, pointPositions, tickLabel, type ChartPoint } from '../lib/progressChart';
import { Button } from './ui/Button';

export type { ChartPoint };

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

  // Downsample to at most 80 representative points when histories are large (e.g. 2000 sessions)
  // so the SVG stays performant, dots don't overlap into an illegible smear, and picking stays snappy.
  const displayedPoints = useMemo(() => downsampleChartPoints(points, 80, selected), [points, selected]);

  const known = useMemo(() => displayedPoints.filter(point => point.value !== null), [displayedPoints]);
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

  if (!displayedPoints.length) {
    return <div className="exercise-chart"><span className="muted">No completed working sets in this range.</span></div>;
  }
  const latestKnown = known.at(-1);
  const selectedIndex = selected === null ? -1 : displayedPoints.findIndex(point => point.key === selected);
  const index = selectedIndex >= 0 ? selectedIndex : latestKnown ? displayedPoints.lastIndexOf(latestKnown) : displayedPoints.length - 1;
  const current = displayedPoints[index];
  const currentValue = current.value === null ? missingLabel : format(current.value);

  const scale = useMemo(() => chartScale(hasTrend ? known.map(point => point.value!) : [0]), [hasTrend, known]);
  const baselineY = height - padBottom;
  const plotHeight = baselineY - padTop;
  const xs = useMemo(() => pointPositions(displayedPoints.length, padLeft, width - padRight), [displayedPoints.length, width]);
  const y = (value: number) => baselineY - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;

  // Consecutive known values form one segment; a session without a value ends it.
  const segments = useMemo(() => {
    const segs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    displayedPoints.forEach((point, i) => {
      if (point.value === null) {
        if (run.length) segs.push(run);
        run = [];
      } else {
        run.push({ x: xs[i], y: baselineY - ((point.value - scale.min) / (scale.max - scale.min)) * plotHeight });
      }
    });
    if (run.length) segs.push(run);
    return segs;
  }, [displayedPoints, xs, baselineY, plotHeight, scale]);

  function pick(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setSelected(displayedPoints[nearestPointIndex(xs, ((event.clientX - box.left) / box.width) * width)].key);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? displayedPoints.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectAt(next);
  }

  function selectAt(next: number) {
    if (next >= 0 && next < displayedPoints.length) setSelected(displayedPoints[next].key);
  }

  const lastIndex = displayedPoints.length - 1;
  const showRange = displayedPoints.length > 1 && displayedPoints[0].date !== displayedPoints[lastIndex].date;
  const activeX = xs[index];
  const activeY = current.value === null ? null : y(current.value);

  return (
    <div className="exercise-chart">
      <div className="exercise-chart-header">
        <div className="exercise-chart-readout" aria-live="polite" aria-atomic="true">
          <span>{current.date}</span>
          <span className="exercise-chart-position">Workout {index + 1} of {displayedPoints.length}</span>
        </div>
        {displayedPoints.length > 1 && <div className="exercise-chart-nav" role="group" aria-label="Browse workouts">
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
        aria-label={`${label}, session ${index + 1} of ${displayedPoints.length}`}
        aria-valuemin={1}
        aria-valuemax={displayedPoints.length}
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

          {displayedPoints.length > 1 && <line className="exercise-chart-guide" x1={activeX} x2={activeX} y1={padTop} y2={baselineY} />}

          {segments.map(segment => segment.length > 1 && (
            <path key={`${segment[0].x}`} className="exercise-chart-line" d={`M ${segment.map(p => `${p.x} ${p.y}`).join(' L ')}`} />
          ))}

          {displayedPoints.map((point, i) => point.value === null
            ? <circle key={point.key} className="exercise-chart-gap" cx={xs[i]} cy={baselineY} r={3} />
            : i !== index && <circle key={point.key} className="exercise-chart-dot" cx={xs[i]} cy={y(point.value)} r={4} />)}

          {activeY !== null && <>
            <circle className="exercise-chart-halo" cx={activeX} cy={activeY} r={10} />
            <circle className="exercise-chart-dot active" cx={activeX} cy={activeY} r={5.5} />
          </>}

          {showRange ? <>
            <text className="exercise-chart-tick" x={xs[0]} y={height - 8} textAnchor="start">{displayedPoints[0].date}</text>
            <text className="exercise-chart-tick" x={xs[lastIndex]} y={height - 8} textAnchor="end">{displayedPoints[lastIndex].date}</text>
          </> : <text className="exercise-chart-tick" x={xs[lastIndex]} y={height - 8} textAnchor={displayedPoints.length > 1 ? 'end' : 'middle'}>{displayedPoints[lastIndex].date}</text>}
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
