import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { MuscleBalanceRow, MuscleBalanceView as MuscleBalanceData } from '../types';
import { ApiError, api } from '../lib/api';
import { formatSets, peakSets, RANGES } from '../lib/muscleBalance';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { MotionPanel } from './ui/Motion';
import { BodyMap, MuscleDetail } from './BodyMap';
import { MuscleBalanceList } from './MuscleBalanceList';
import './MuscleBalance.css';

type BalanceRange = typeof RANGES[number]['value'];

function dateLabel(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sortMuscles(rows: MuscleBalanceRow[]) {
  return [...rows].sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
}

export function MuscleBalanceView({ timeZone }: { timeZone: string }) {
  const [range, setRange] = useState<BalanceRange>('1w');
  const [retry, setRetry] = useState(0);
  const [views, setViews] = useState<Partial<Record<BalanceRange, MuscleBalanceData>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pinnedMuscle, setPinnedMuscle] = useState<string | null>(null);
  const [hoveredMuscle, setHoveredMuscle] = useState<string | null>(null);
  const requestId = useRef(0);
  const activeMuscle = hoveredMuscle ?? pinnedMuscle;
  const [lastView, setLastView] = useState<MuscleBalanceData | null>(null);
  const view = views[range] ?? lastView;
  const muscles = useMemo(() => sortMuscles(view?.muscles ?? []), [view?.muscles]);
  const trained = useMemo(() => muscles.filter(muscle => muscle.sets > 0), [muscles]);
  const untrained = useMemo(() => muscles.filter(muscle => muscle.sets <= 0), [muscles]);
  const peak = useMemo(() => peakSets(muscles), [muscles]);
  const detail = useMemo(() => muscles.find(muscle => muscle.muscle === activeMuscle) ?? null, [activeMuscle, muscles]);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError('');

    api.muscleBalance(range, timeZone, controller.signal)
      .then(next => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setViews(current => ({ ...current, [range]: next }));
        setLastView(next);
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

  /// Tapping a muscle pins it, which is how a touch device reads the same stats a pointer gets by
  /// hovering. A pinned muscle stays until it is tapped again.
  const selectMuscle = useCallback((muscleName: string) => {
    setPinnedMuscle(current => (current === muscleName ? null : muscleName));
    setHoveredMuscle(current => (current === muscleName && pinnedMuscle === muscleName ? null : current));
  }, [pinnedMuscle]);

  const hasCompletedSets = (view?.totalSets ?? 0) > 0;

  return (
    <div className="muscle-balance-page">
      <div className="page-heading">
        <h1 data-page-heading tabIndex={-1}>Muscle coverage</h1>
      </div>

      {error && (
        <div className="error-banner muscle-balance-error" role="alert">
          <span>{error}</span>
          <Button variant="tertiary" onClick={() => setRetry(value => value + 1)}>
            <RotateCw size={15} />Retry
          </Button>
        </div>
      )}

      {!view && loading && (
        <section className="panel muscle-balance-loading" aria-label="Loading muscle coverage" aria-busy="true">
          <div className="skeleton muscle-balance-loading-title" />
          <div className="skeleton muscle-balance-loading-map" />
          <div className="skeleton muscle-balance-loading-list" />
        </section>
      )}

      {view && (
        <>
          <div className="muscle-balance-stats-strip" role="region" aria-label="Coverage summary">
            <div className="muscle-balance-stat-card">
              <span className="muscle-balance-stat-label">Workouts</span>
              <strong className="muscle-balance-stat-value">{view.sessions ? view.sessions : '—'}</strong>
            </div>
            <div className="muscle-balance-stat-card">
              <span className="muscle-balance-stat-label">Total sets</span>
              <strong className="muscle-balance-stat-value">{view.totalSets > 0 ? formatSets(view.totalSets) : '—'}</strong>
            </div>
            <div className="muscle-balance-stat-card">
              <span className="muscle-balance-stat-label">Trained groups</span>
              <strong className="muscle-balance-stat-value">{trained.length > 0 ? `${trained.length} of ${muscles.length}` : '—'}</strong>
            </div>
            <div className="muscle-balance-stat-card">
              <span className="muscle-balance-stat-label">Top muscle</span>
              <strong className="muscle-balance-stat-value">{trained[0]?.muscle ?? '—'}</strong>
            </div>
          </div>

          <section className="panel muscle-balance-map-panel" aria-busy={loading}>
            <div className="section-heading muscle-balance-section-heading">
              <h2>Coverage</h2>
              <div className="muscle-balance-range-control">
                {loading && <span className="muted" role="status">Updating…</span>}
                <Select
                  name="muscle-balance-range"
                  ariaLabel="Muscle coverage period"
                  value={range}
                  options={RANGES.map(option => ({ value: option.value, label: option.label }))}
                  onChange={value => setRange(value as BalanceRange)}
                />
              </div>
            </div>
            <MotionPanel motionKey={`muscle-map-${range}`} className="muscle-balance-map-body">
              <BodyMap
                muscles={view.muscles}
                peak={peak}
                activeMuscle={activeMuscle}
                onHoverMuscle={setHoveredMuscle}
                onSelectMuscle={selectMuscle}
              />
              <MuscleDetail muscle={detail} dateLabel={dateLabel} />
            </MotionPanel>
            <div className="muscle-balance-legend" aria-label="Coverage frequency scale">
              <span className="muscle-legend-item"><i className="legend-swatch empty" />Untrained</span>
              <span className="muscle-legend-item"><i className="legend-swatch low" />Less frequent</span>
              <span className="muscle-legend-item"><i className="legend-swatch mid" />Frequent</span>
              <span className="muscle-legend-item"><i className="legend-swatch peak" />Most frequent</span>
            </div>
            {!hasCompletedSets && <p className="muscle-balance-empty-note" role="status">No completed sets in this window.</p>}
            <details className="muscle-balance-method">
              <summary>How coverage is counted</summary>
              <p>
                Each completed working set credits its primary muscle as 1 set and each listed or estimated indirect
                muscle as 0.5. Warm-ups and unfinished workouts are excluded. Shading is relative to your busiest
                muscle in this window{peak > 0 ? `, ${trained[0]?.muscle} at ${formatSets(peak)} sets` : ''}.
              </p>
            </details>
          </section>

          <MotionPanel motionKey={`muscle-list-${range}`} className="panel muscle-balance-list-panel">
            <div className="section-heading muscle-balance-section-heading">
              <h2>Muscles</h2>
              {trained.length > 0 && <span className="muted">{trained.length} trained</span>}
            </div>
            {trained.length > 0
              ? <MuscleBalanceList
                muscles={trained}
                peak={peak}
                dateLabel={dateLabel}
                activeMuscle={activeMuscle}
                onHoverMuscle={setHoveredMuscle}
                onSelectMuscle={selectMuscle}
              />
              : <p className="muscle-balance-empty-note" role="status">No muscle has credited sets in this window yet.</p>}
            {untrained.length > 0 && (
              <details className="muscle-balance-untrained">
                <summary>Not trained in this window ({untrained.length})</summary>
                <div className="muscle-balance-untrained-chips">
                  {untrained.map(muscle => <span key={muscle.muscle} className="muscle-chip">{muscle.muscle}</span>)}
                </div>
              </details>
            )}
            {view.unattributedSets > 0 && (
              <p className="muscle-balance-unattributed">
                {formatSets(view.unattributedSets)} completed {view.unattributedSets === 1 ? 'set could' : 'sets could'} not be matched to a muscle and are excluded from the map.
                {view.unattributedExamples.length > 0 && <> Examples: {view.unattributedExamples.slice(0, 3).join(', ')}.</>}
              </p>
            )}
          </MotionPanel>
        </>
      )}
    </div>
  );
}
