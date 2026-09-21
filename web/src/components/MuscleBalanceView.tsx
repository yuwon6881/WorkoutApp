import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { MuscleBalanceRow, MuscleBalanceView as MuscleBalanceData } from '../types';
import { ApiError, api } from '../lib/api';
import { BAND_LABELS, formatSets, RANGES } from '../lib/muscleBalance';
import { Button } from './ui/Button';
import { MotionPanel } from './ui/Motion';
import { BodyMap } from './BodyMap';
import { MuscleBalanceList } from './MuscleBalanceList';
import './MuscleBalance.css';

type BalanceRange = typeof RANGES[number]['value'];

function rangeLabel(value: BalanceRange) {
  return RANGES.find(range => range.value === value)?.label ?? 'Selected range';
}

function scaledSets(weeklySets: number, weeks: number) {
  return formatSets(weeklySets * weeks);
}

function bandRangeLabel(band: number, weeks: number) {
  const five = scaledSets(5, weeks);
  const ten = scaledSets(10, weeks);
  const twenty = scaledSets(20, weeks);
  if (band === 0) return '0 sets';
  if (band === 1) return `>0–<${five} sets`;
  if (band === 2) return `${five}–<${ten} sets`;
  if (band === 3) return `${ten}–${twenty} sets`;
  return `>${twenty} sets`;
}

function dateLabel(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sortMuscles(rows: MuscleBalanceRow[]) {
  return [...rows].sort((a, b) => {
    if (a.sets === 0 && b.sets !== 0) return 1;
    if (b.sets === 0 && a.sets !== 0) return -1;
    return b.sets - a.sets || a.muscle.localeCompare(b.muscle);
  });
}

export function MuscleBalanceView({ timeZone }: { timeZone: string }) {
  const [range, setRange] = useState<BalanceRange>('1w');
  const [retry, setRetry] = useState(0);
  const [views, setViews] = useState<Partial<Record<BalanceRange, MuscleBalanceData>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const view = views[range] ?? null;
  const muscles = useMemo(() => sortMuscles(view?.muscles ?? []), [view?.muscles]);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError('');

    api.muscleBalance(range, timeZone, controller.signal)
      .then(next => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setViews(current => ({ ...current, [range]: next }));
      })
      .catch(failure => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setError(failure instanceof ApiError ? failure.message : 'Muscle coverage could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted && id === requestId.current) setLoading(false);
      });

    return () => controller.abort();
  }, [range, retry, timeZone]);

  const hasCompletedSets = (view?.totalSets ?? 0) > 0;

  return <div className="muscle-balance-page">
    <div className="page-heading">
      <h1 data-page-heading tabIndex={-1}>Muscle coverage</h1>
      <p>See which muscles your completed working sets have trained.</p>
    </div>

    <div className="muscle-balance-range" role="group" aria-label="Muscle coverage period">
      {RANGES.map(option => <Button
        key={option.value}
        presentation="plain"
        className={`filter-chip ${range === option.value ? 'active' : ''}`}
        aria-pressed={range === option.value}
        onClick={() => setRange(option.value)}
      >{option.label}</Button>)}
    </div>

    {error && <div className="error-banner muscle-balance-error" role="alert">
      <span>{error}</span>
      <Button variant="tertiary" onClick={() => setRetry(value => value + 1)}>
        <RotateCw size={15} />Retry
      </Button>
    </div>}

    {!view && loading && <section className="panel muscle-balance-loading" aria-label="Loading muscle coverage" aria-busy="true">
      <div className="skeleton muscle-balance-loading-title" />
      <div className="skeleton muscle-balance-loading-map" />
      <div className="skeleton muscle-balance-loading-list" />
    </section>}

    {view && <>
      <MotionPanel motionKey={`muscle-map-${range}`} className="panel muscle-balance-map-panel">
        <div className="section-heading muscle-balance-section-heading">
          <div>
            <h2>{rangeLabel(range)} muscle coverage</h2>
            <p>{view.sessions} {view.sessions === 1 ? 'workout' : 'workouts'} · {formatSets(view.totalSets)} completed working {view.totalSets === 1 ? 'set' : 'sets'}</p>
          </div>
          {loading && <span className="muted" role="status">Updating…</span>}
        </div>
        <p className="muscle-balance-explainer">
          Each completed working set credits its primary muscle as 1 set and each listed or estimated indirect muscle as 0.5. Warm-ups and unfinished workouts are excluded.
        </p>
        {!hasCompletedSets && <p className="muscle-balance-empty-note" role="status">No completed sets in this window.</p>}
        <BodyMap muscles={view.muscles} weeks={view.weeks} />
        <div className="muscle-balance-legend" role="group" aria-label="Muscle set bands">
          {BAND_LABELS.map((label, band) => <div className="muscle-balance-legend-item" key={label}>
            <span className={`muscle-balance-swatch band-${band}`} aria-hidden="true" />
            <span className="muscle-balance-legend-copy"><strong>{label}</strong><small>{bandRangeLabel(band, view.weeks)}</small></span>
          </div>)}
        </div>
      </MotionPanel>

      <MotionPanel motionKey={`muscle-list-${range}`} className="panel muscle-balance-list-panel">
        <div className="section-heading muscle-balance-section-heading">
          <div>
            <h2>Muscles</h2>
            <p>Sorted by credited sets; untrained muscles are listed last.</p>
          </div>
        </div>
        <MuscleBalanceList muscles={muscles} weeks={view.weeks} dateLabel={dateLabel} />
        {view.unattributedSets > 0 && <p className="muscle-balance-unattributed">
          {formatSets(view.unattributedSets)} completed {view.unattributedSets === 1 ? 'set could' : 'sets could'} not be matched to a muscle and are excluded from the map.
          {view.unattributedExamples.length > 0 && <> Examples: {view.unattributedExamples.slice(0, 3).join(', ')}.</>}
        </p>}
      </MotionPanel>
    </>}
  </div>;
}
