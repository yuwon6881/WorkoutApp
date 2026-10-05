import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { MuscleBalanceRow, MuscleBalanceView as MuscleBalanceData } from '../types';
import { ApiError, api } from '../lib/api';
import { formatSets, peakSets, RANGES } from '../lib/muscleBalance';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { MotionPanel } from './ui/Motion';
import { BodyMap, MuscleDetail } from './BodyMap';
import './MuscleBalance.css';

type BalanceRange = typeof RANGES[number]['value'];

function dateLabel(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

const LOWER_BODY_MUSCLES = new Set([
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors'
]);

function isLowerBody(muscle: string): boolean {
  return LOWER_BODY_MUSCLES.has(muscle);
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
  const peak = useMemo(() => peakSets(muscles), [muscles]);
  const detail = useMemo(() => muscles.find(muscle => muscle.muscle === activeMuscle) ?? null, [activeMuscle, muscles]);

  const upperMuscles = useMemo(() => muscles.filter(m => !isLowerBody(m.muscle)), [muscles]);
  const lowerMuscles = useMemo(() => muscles.filter(m => isLowerBody(m.muscle)), [muscles]);
  const upperTotal = useMemo(() => upperMuscles.reduce((sum, m) => sum + m.sets, 0), [upperMuscles]);
  const lowerTotal = useMemo(() => lowerMuscles.reduce((sum, m) => sum + m.sets, 0), [lowerMuscles]);
  const maxMuscleSets = useMemo(() => Math.max(...muscles.map(m => m.sets), 0), [muscles]);

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
            {view.unattributedSets > 0 && (
              <p className="muscle-balance-unattributed">
                {formatSets(view.unattributedSets)} completed {view.unattributedSets === 1 ? 'set could' : 'sets could'} not be matched to a muscle and are excluded from the map.
                {view.unattributedExamples.length > 0 && <> Examples: {view.unattributedExamples.slice(0, 3).join(', ')}.</>}
              </p>
            )}
          </section>

          <section className="panel muscle-breakdown-panel" aria-labelledby="muscle-breakdown-heading">
            <div className="section-heading muscle-breakdown-heading">
              <div>
                <h2 id="muscle-breakdown-heading">Muscle breakdown</h2>
                <p className="muscle-breakdown-subtitle">Sets by muscle group in the selected window</p>
              </div>
            </div>

            <div className="muscle-breakdown-groups">
              <div className="muscle-breakdown-group">
                <div className="muscle-group-header">
                  <h3>Upper body</h3>
                  <span className="pill pill-accent">{formatSets(upperTotal)} {upperTotal === 1 ? 'set' : 'sets'}</span>
                </div>
                <ul className="muscle-breakdown-list" role="list">
                  {upperMuscles.map(m => {
                    const isActive = activeMuscle === m.muscle;
                    const pct = maxMuscleSets > 0 ? Math.round((m.sets / maxMuscleSets) * 100) : 0;
                    return (
                      <li
                        key={m.muscle}
                        className={`muscle-breakdown-item${m.sets > 0 ? ' is-trained' : ' is-untrained'}${isActive ? ' is-active' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectMuscle(m.muscle)}
                        onMouseEnter={() => setHoveredMuscle(m.muscle)}
                        onMouseLeave={() => setHoveredMuscle(null)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectMuscle(m.muscle);
                          }
                        }}
                        aria-pressed={isActive}
                      >
                        <div className="muscle-breakdown-row">
                          <span className="muscle-breakdown-name">{m.muscle}</span>
                          <span className="muscle-breakdown-sets">
                            <strong>{formatSets(m.sets)}</strong> <small>{m.sets === 1 ? 'set' : 'sets'}</small>
                          </span>
                        </div>
                        <div className="muscle-breakdown-track" aria-hidden="true">
                          <div
                            className="muscle-breakdown-fill"
                            style={{ width: `${m.sets > 0 ? Math.max(pct, 4) : 0}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="muscle-breakdown-group">
                <div className="muscle-group-header">
                  <h3>Lower body</h3>
                  <span className="pill pill-accent">{formatSets(lowerTotal)} {lowerTotal === 1 ? 'set' : 'sets'}</span>
                </div>
                <ul className="muscle-breakdown-list" role="list">
                  {lowerMuscles.map(m => {
                    const isActive = activeMuscle === m.muscle;
                    const pct = maxMuscleSets > 0 ? Math.round((m.sets / maxMuscleSets) * 100) : 0;
                    return (
                      <li
                        key={m.muscle}
                        className={`muscle-breakdown-item${m.sets > 0 ? ' is-trained' : ' is-untrained'}${isActive ? ' is-active' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectMuscle(m.muscle)}
                        onMouseEnter={() => setHoveredMuscle(m.muscle)}
                        onMouseLeave={() => setHoveredMuscle(null)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectMuscle(m.muscle);
                          }
                        }}
                        aria-pressed={isActive}
                      >
                        <div className="muscle-breakdown-row">
                          <span className="muscle-breakdown-name">{m.muscle}</span>
                          <span className="muscle-breakdown-sets">
                            <strong>{formatSets(m.sets)}</strong> <small>{m.sets === 1 ? 'set' : 'sets'}</small>
                          </span>
                        </div>
                        <div className="muscle-breakdown-track" aria-hidden="true">
                          <div
                            className="muscle-breakdown-fill"
                            style={{ width: `${m.sets > 0 ? Math.max(pct, 4) : 0}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
