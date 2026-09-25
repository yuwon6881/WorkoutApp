import { useEffect, useState } from 'react';
import { ArrowLeftRight, Dumbbell, Library, Link2, Plus, Search, X, Trash2, RotateCcw, TrendingUp } from 'lucide-react';
import type { Exercise, ExerciseCategory, ExerciseClearPreview, ExerciseInsight, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { CustomExerciseModal } from './CustomExerciseModal';
import { getExerciseCategory } from '../lib/exerciseCategory';
import { ChipScroller } from './ui/ChipScroller';
import './Exercises.css';

/// The catalog is supplied by the server and is empty until a seed file is loaded, so the
/// empty state explains that rather than implying the user should have added something.
export type ExercisePickerAction = 'add' | 'swap' | 'map';

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function exerciseRank(candidate: Exercise, current: Exercise | undefined, preferredNames: string[]) {
  const candidateNames = [candidate.name, ...candidate.aliases].map(normalized);
  if (preferredNames.some(name => candidateNames.includes(normalized(name)))) return 0;
  if (!current) return 1;

  const primary = normalized(current.muscle);
  const secondary = new Set((current.secondaryMuscles ?? []).map(normalized));
  const candidatePrimary = normalized(candidate.muscle);
  const candidateSecondary = (candidate.secondaryMuscles ?? []).map(normalized);
  const sharedSecondary = candidateSecondary.filter(value => secondary.has(value)).length;
  if (candidatePrimary === primary && sharedSecondary > 0) return 1;
  if (candidatePrimary === primary) return 2;
  if (secondary.has(candidatePrimary) || candidateSecondary.includes(primary)) return 3;
  return 4;
}

export function ExerciseLibrary({ exercises, onSelect, exclude = [], onOpen, onChanged, action = 'add', currentExerciseId, preferredNames = [], disabled = false }: {
  exercises: Exercise[];
  onSelect?: (id: string) => void;
  exclude?: string[];
  onOpen?: (exercise: Exercise) => void;
  onChanged?: () => Promise<void> | void;
  action?: ExercisePickerAction;
  currentExerciseId?: string | null;
  preferredNames?: string[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('All muscles');
  const [source, setSource] = useState<'all' | 'custom' | 'catalog'>('all');
  const [category, setCategory] = useState<'all' | ExerciseCategory>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [showAllMuscles, setShowAllMuscles] = useState(false);

  useEffect(() => {
    setShowAllMuscles(false);
  }, [muscle, category, source, currentExerciseId]);

  const muscles = ['All muscles', ...new Map(exercises.flatMap(e => [e.muscle, ...(e.secondaryMuscles ?? [])])
    .filter(Boolean).map(value => [value.toLowerCase(), value] as const)).values()];
  const current = currentExerciseId ? exercises.find(e => e.id === currentExerciseId) : undefined;
  const isSwapping = action === 'swap' && !!current;

  // Candidate replacement exercises exclude existing exclusions and the current exercise being swapped
  const excluded = new Set([...exclude, ...(currentExerciseId ? [currentExerciseId] : [])]);
  const filtered = exercises.filter(e => !excluded.has(e.id)
    && (source === 'all' || (source === 'custom' ? e.isCustom : !e.isCustom))
    && (category === 'all' || getExerciseCategory(e) === category)
    && (muscle === 'All muscles' || [e.muscle, ...(e.secondaryMuscles ?? [])].some(value => value.toLowerCase() === muscle.toLowerCase()))
    && `${e.name} ${e.equipment} ${e.muscle} ${(e.secondaryMuscles ?? []).join(' ')} ${e.movementPattern ?? ''} ${e.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const ordered = [...filtered].sort((a, b) => exerciseRank(a, current, preferredNames) - exerciseRank(b, current, preferredNames)
    || a.name.localeCompare(b.name));
  const actionLabel = action === 'swap' ? 'Swap' : action === 'map' ? 'Map' : 'Add';
  const ActionIcon = action === 'add' ? Plus : action === 'swap' ? ArrowLeftRight : Link2;

  const currentCategory = current ? getExerciseCategory(current) : null;
  const baseCategories: ExerciseCategory[] = ['Free Weights', 'Machine', 'Body Weight'];
  const categoryOrder: ExerciseCategory[] = currentCategory
    ? [currentCategory, ...baseCategories.filter(c => c !== currentCategory)]
    : ['Free Weights', 'Machine', 'Body Weight'];

  const isRelevant = (e: Exercise) => exerciseRank(e, current, preferredNames) < 4;
  const showBoundary = isSwapping && !query.trim() && muscle === 'All muscles';
  const relevantList = showBoundary ? ordered.filter(isRelevant) : ordered;
  const otherList = showBoundary ? ordered.filter(e => !isRelevant(e)) : [];

  const currentMatches = current && (!query.trim() || `${current.name} ${current.equipment} ${current.muscle} ${(current.secondaryMuscles ?? []).join(' ')} ${current.movementPattern ?? ''} ${current.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    && (source === 'all' || (source === 'custom' ? current.isCustom : !current.isCustom))
    && (category === 'all' || getExerciseCategory(current) === category)
    && (muscle === 'All muscles' || [current.muscle, ...(current.secondaryMuscles ?? [])].some(val => val.toLowerCase() === muscle.toLowerCase()));
  const showCurrentAtTop = isSwapping && current && currentMatches && (muscle === 'All muscles' || [current.muscle, ...(current.secondaryMuscles ?? [])].some(val => val.toLowerCase() === muscle.toLowerCase()));

  function renderCategoryGroups(items: Exercise[]) {
    return categoryOrder.map(cat => {
      const catItems = items.filter(e => getExerciseCategory(e) === cat);
      if (!catItems.length) return null;
      return (
        <section className="category-group" key={cat} aria-label={`${cat} exercises`}>
          <div className="category-group-header">
            <h4 className="category-group-title">{cat}</h4>
            <span className="tiny-label category-group-count">{catItems.length}</span>
          </div>
          <div className={onSelect ? 'picker-list' : 'exercise-grid'}>
            {catItems.map(e => (
              onSelect ? (
                <article className="panel picker-card" key={e.id}>
                  <div className="picker-card-info">
                    <div className="picker-card-header">
                      <span className="picker-exercise-icon" aria-hidden="true"><Dumbbell size={16} /></span>
                      <h3 title={e.name}>{e.name}</h3>
                    </div>
                    <div className="picker-tags">
                      {e.isCustom && <span className="pill pill-muted">Custom</span>}
                      <span className="pill pill-accent picker-muscle-tag">{e.muscle || 'Full body'}</span>
                      {e.secondaryMuscles && e.secondaryMuscles.length > 0 && (
                        <span className="pill pill-muted">{e.secondaryMuscles[0]}</span>
                      )}
                      {e.secondaryMuscles && e.secondaryMuscles.length > 1 && (
                        <span className="pill pill-muted pill-overflow" title={e.secondaryMuscles.slice(1).join(', ')}>
                          +{e.secondaryMuscles.length - 1}
                        </span>
                      )}
                      <span className="pill pill-equipment">{e.equipment || 'General'}</span>
                      <span className="pill pill-category">{cat}</span>
                    </div>
                  </div>
                  <Button
                    className="picker-add-btn"
                    variant="secondary"
                    aria-label={`${actionLabel} ${e.name}`}
                    disabled={disabled}
                    onClick={() => onSelect(e.id)}
                  >
                    <ActionIcon size={16} />
                    <span className="picker-add-label">{actionLabel}</span>
                  </Button>
                </article>
              ) : (
                <article className="panel exercise-card exercise-card-action" key={e.id} tabIndex={0} role="button" aria-label={`View ${e.name} details`}
                  onClick={() => onOpen?.(e)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(e); } }}>
                  <div className="exercise-card-top">
                    <span className="exercise-icon"><Dumbbell size={22} /></span>
                    <div className="exercise-card-badges">
                      <span className="pill pill-equipment">{e.equipment || 'General'}</span>
                      <span className="pill pill-category">{cat}</span>
                    </div>
                  </div>
                  <div className="exercise-card-meta">
                    {e.isCustom && <span className="pill pill-muted">Custom</span>}
                    <span className="pill pill-accent">{e.muscle || 'Full body'}</span>
                    {e.secondaryMuscles && e.secondaryMuscles.length > 0 && (
                      <span className="pill pill-muted">{e.secondaryMuscles[0]}</span>
                    )}
                    {e.secondaryMuscles && e.secondaryMuscles.length > 1 && (
                      <span className="pill pill-muted pill-overflow" title={e.secondaryMuscles.slice(1).join(', ')}>
                        +{e.secondaryMuscles.length - 1}
                      </span>
                    )}
                  </div>
                  <div className="exercise-card-body">
                    <h3 title={e.name}>{e.name}</h3>
                    {e.cue && <p>{e.cue}</p>}
                  </div>
                </article>
              )
            ))}
          </div>
        </section>
      );
    });
  }

  if (!exercises.length) return <>
    {!onSelect && <div className="page-heading"><h1 data-page-heading tabIndex={-1}>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="empty-message">
      <Library size={32} />
      <h3>No exercises available</h3>
      <p>The shared exercise library has not been loaded yet.</p>
    </div>
    {createOpen && <CustomExerciseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await onChanged?.(); }} />}
  </>;

  return <div>
    {!onSelect && <div className="page-heading"><h1 data-page-heading tabIndex={-1}>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="search-row">
      <label className="search-box">
        <Search size={18} />
        <input name="exercise-search" aria-label="Search exercises" placeholder="Search exercises or equipment…" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <Button presentation="plain" className="search-clear-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></Button>}
      </label>
      <div className="exercise-minor-filters" role="group" aria-label="Filter exercises">
        <Select
          name="exercise-source-filter"
          ariaLabel="Filter exercise source"
          value={source}
          onChange={val => setSource(val as 'all' | 'custom' | 'catalog')}
          className="exercise-filter-select"
          options={[
            { value: 'all', label: 'All types' },
            { value: 'catalog', label: 'Standard' },
            { value: 'custom', label: 'Custom' }
          ]}
        />
        <Select
          name="exercise-category-filter"
          ariaLabel="Filter exercise category"
          value={category}
          onChange={val => setCategory(val as 'all' | ExerciseCategory)}
          className="exercise-filter-select"
          options={[
            { value: 'all', label: 'All equipment' },
            { value: 'Free Weights', label: 'Free Weights' },
            { value: 'Machine', label: 'Machine' },
            { value: 'Body Weight', label: 'Body Weight' }
          ]}
        />
      </div>
    </div>
    <ChipScroller ariaLabel="Filter exercises by muscle" resetKey={muscles.join('|')}
      leftLabel="Scroll muscle filters left" rightLabel="Scroll muscle filters right">
        {muscles.map(m => (
          <Button
            presentation="plain"
            key={m}
            className={`filter-chip ${muscle === m ? 'active' : ''}`}
            onClick={() => setMuscle(m)}
          >
            {m}
          </Button>
        ))}
    </ChipScroller>

    {showCurrentAtTop && (
      <div className="picker-current-section">
        <span className="tiny-label">Current exercise</span>
        <article className="panel picker-card picker-card-current" key={`current-${current.id}`}>
          <div className="picker-card-info">
            <div className="picker-card-header">
              <span className="picker-exercise-icon" aria-hidden="true"><Dumbbell size={16} /></span>
              <h3 title={current.name}>{current.name}</h3>
            </div>
            <div className="picker-tags">
              {current.isCustom && <span className="pill pill-muted">Custom</span>}
              <span className="pill pill-accent picker-muscle-tag">{current.muscle || 'Full body'}</span>
              {(current.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={`cur-${current.id}-${secondary}`}>{secondary}</span>)}
              <span className="pill pill-equipment">{current.equipment || 'General'}</span>
              <span className="pill pill-category">{getExerciseCategory(current)}</span>
            </div>
          </div>
          <Button
            className="picker-add-btn picker-current-btn"
            variant="secondary"
            aria-label={`Current exercise: ${current.name}`}
            disabled
          >
            <span className="picker-add-label">Current</span>
          </Button>
        </article>
      </div>
    )}

    {renderCategoryGroups(relevantList)}

    {showBoundary && otherList.length > 0 && !showAllMuscles && (
      <div className="picker-relevancy-boundary" role="region" aria-label="End of similar exercises">
        <div className="picker-divider-line" />
        <div className="picker-boundary-content">
          <p className="picker-boundary-text">Showing exercises similar to {current.name}.</p>
          <Button
            variant="secondary"
            className="picker-show-all-btn"
            onClick={() => setShowAllMuscles(true)}
          >
            Show all exercises
          </Button>
        </div>
      </div>
    )}

    {showBoundary && otherList.length > 0 && showAllMuscles && (
      <>
        <div className="picker-relevancy-boundary" role="region" aria-label="Other muscle exercises">
          <div className="picker-divider-line" />
          <div className="picker-boundary-content">
            <span className="tiny-label picker-boundary-label">Other muscle exercises</span>
          </div>
        </div>
        {renderCategoryGroups(otherList)}
      </>
    )}

    {!filtered.length && !showCurrentAtTop && <p className="empty-message">No matching exercises.</p>}
    {createOpen && <CustomExerciseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await onChanged?.(); }} />}
  </div>;
}

function displayKg(value: number | null | undefined, unit: 'kg' | 'lb') {
  if (value == null) return '—';
  const amount = unit === 'lb' ? value * 2.2046226218 : value;
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${unit}`;
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export function ExerciseDetailModal({ exercise, unit, onClose, onChanged, onSession }: { exercise: Exercise; unit: 'kg' | 'lb'; onClose: () => void; onChanged?: () => Promise<void> | void; onSession?: (session: Session) => void }) {
  const [insight, setInsight] = useState<ExerciseInsight | null>(null); const [range, setRange] = useState('3m'); const [metric, setMetric] = useState<ChartMetric>('estimated1rm'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [historyBusy, setHistoryBusy] = useState(false); const [clearPreview, setClearPreview] = useState<ExerciseClearPreview | null>(null); const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => { const controller = new AbortController(); setInsight(null); setError(''); api.exerciseInsight(exercise.id, range, 0, 20, controller.signal).then(setInsight).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof ApiError ? failure.message : 'Could not load exercise details.'); }); return () => controller.abort(); }, [exercise.id, range]);
  async function clearHistory() { setBusy(true); try { const preview = await api.exerciseClearPreview(exercise.id); if (preview.hasActiveWorkout) { setError('Finish or discard the active workout before clearing this exercise.'); return; } setClearPreview(preview); } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not prepare history clearing.'); } finally { setBusy(false); } }
  async function confirmClear() { setBusy(true); try { await api.clearExerciseHistory(exercise.id); setClearPreview(null); setInsight(null); await onChanged?.(); setInsight(await api.exerciseInsight(exercise.id, range, 0, 20)); } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not clear this exercise history.'); } finally { setBusy(false); } }
  async function deleteExercise() { setBusy(true); try { await api.deleteCustomExercise(exercise.id); setDeleteConfirm(false); await onChanged?.(); onClose(); } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not delete this custom exercise.'); } finally { setBusy(false); } }
  async function moreHistory() { if (!insight || historyBusy || insight.history.length >= insight.totalHistoryRows) return; setHistoryBusy(true); try { const next = await api.exerciseInsight(exercise.id, range, insight.page + 1, insight.size); setInsight(current => current ? { ...current, history: [...current.history, ...next.history], page: next.page } : next); } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load more exercise history.'); } finally { setHistoryBusy(false); } }
  const chartMax = insight ? Math.max(1, ...insight.points.map(point => metricValue(point, metric) ?? 0)) : 1;
  return <>
    <Modal title={exercise.name} onClose={onClose} wide>
      <div className="modal-body exercise-detail-modal">
        <div className="exercise-detail-meta">
          <span className="pill pill-accent">{exercise.archived && exercise.isCustom ? 'Deleted custom exercise' : exercise.isCustom ? 'Custom exercise' : exercise.muscle || 'Full body'}</span>
          {(exercise.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={secondary}>{secondary}</span>)}
          <span className="pill">{exercise.equipment || 'General'}</span>
          <span className="pill pill-category">{getExerciseCategory(exercise)}</span>
        </div>
        {exercise.cue && <p className="muted">{exercise.cue}</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {!insight && !error && <div className="skeleton detail-loading" aria-label="Loading exercise details" />}
        {insight && <>
          <div className="section-heading"><h3>Progress</h3><div className="detail-selectors"><label className="field"><span>Metric</span><Select name="progress-metric-select" label="Progress metric" value={metric} onChange={val => setMetric(val as ChartMetric)} options={[{ value: 'estimated1rm', label: 'Estimated 1RM' }, { value: 'load', label: 'Heaviest load' }, { value: 'volume', label: 'Session volume' }, { value: 'reps', label: 'Reps' }]} /></label><label className="field"><span>Range</span><Select name="progress-range-select" label="Progress range" value={range} onChange={val => setRange(val as string)} options={[{ value: '1m', label: 'Last month' }, { value: '3m', label: 'Last 3 months' }, { value: '6m', label: 'Last 6 months' }, { value: 'all', label: 'All time' }]} /></label></div></div>
          <div className="exercise-chart" role="img" aria-label={`${chartMetricLabel(metric)} progress chart`}><div className="exercise-chart-bars">{insight.points.length ? insight.points.map(point => { const value = metricValue(point, metric); return <div className="exercise-chart-point" key={`${point.sessionId}-${point.date}`} aria-label={`${dateLabel(point.date)}: ${formatMetricValue(value, metric, unit)}`}><i style={{ height: `${Math.max(4, Math.min(100, ((value ?? 0) / chartMax) * 100))}%` }} /><small>{dateLabel(point.date)}</small></div>; }) : <span className="muted">No completed working sets in this range.</span>}</div></div>
          <div className="chart-table" role="table" aria-label="Exercise progress table"><div className="chart-table-row chart-table-head" role="row"><span>Date</span><span>1RM</span><span>Load</span><span>Volume</span><span>Reps</span></div>{insight.points.map(point => <div className="chart-table-row" role="row" key={`row-${point.sessionId}-${point.date}`}><span>{dateLabel(point.date)}</span><span>{displayKg(point.estimated1RmKg, unit)}</span><span>{displayKg(point.loadKg, unit)}</span><span>{displayKg(point.volumeKg, unit)}{point.partial ? ' *' : ''}</span><span>{point.reps ?? '—'}</span></div>)}</div>
          {insight.partialVolume && <p className="muted detail-note">* Volume is partial because one or more logged loads were unknown.</p>}
          <div className="detail-record-grid">
            <div className="stat-card"><span className="stat-label">Estimated 1RM</span><strong>{displayKg(insight.estimated1RmKg, unit)}</strong>{insight.estimated1RmKg != null && <small>{dateLabel(insight.estimated1RmDate)}</small>}</div>
            <div className="stat-card"><span className="stat-label">Heaviest load</span><strong>{displayKg(insight.heaviestKg, unit)}</strong>{insight.heaviestKg != null && <small>{insight.heaviestReps ? `${insight.heaviestReps} reps · ` : ''}{dateLabel(insight.heaviestDate)}</small>}</div>
            <div className="stat-card"><span className="stat-label">Largest set volume</span><strong>{displayKg(insight.largestSetVolumeKg, unit)}</strong>{insight.largestSetVolumeKg != null && <small>{dateLabel(insight.largestSetVolumeDate)}</small>}</div>
            <div className="stat-card"><span className="stat-label">Largest session volume</span><strong>{displayKg(insight.largestSessionVolumeKg, unit)}</strong>{insight.largestSessionVolumeKg != null && <small>{dateLabel(insight.largestSessionVolumeDate)}</small>}</div>
            <div className="stat-card"><span className="stat-label">Rep PR</span><strong>{insight.repPr ?? '—'}</strong>{insight.repPr != null && <small>{dateLabel(insight.repPrDate)}</small>}</div>
            <div className="stat-card"><span className="stat-label">Sessions</span><strong>{insight.sessions > 0 ? insight.sessions : '—'}</strong>{insight.sessions > 0 && <small>completed workouts</small>}</div>
            <div className="stat-card"><span className="stat-label">Last performed</span><strong>{dateLabel(insight.lastPerformedDate)}</strong>{insight.setCount > 0 && <small>{insight.setCount} working sets</small>}</div>
          </div>
          <div className="detail-resistance-records" aria-label="Resistance records">{insight.externalLoadPrKg != null && <span>External load PR <strong>{displayKg(insight.externalLoadPrKg, unit)}</strong></span>}{insight.addedLoadPrKg != null && <span>Added load PR <strong>{displayKg(insight.addedLoadPrKg, unit)}</strong></span>}{insight.assistanceReductionPrKg != null && <span>Lowest assistance <strong>{displayKg(insight.assistanceReductionPrKg, unit)}</strong></span>}{insight.systemLoadPrKg != null && <span>System load PR <strong>{displayKg(insight.systemLoadPrKg, unit)}</strong></span>}</div>
          <div className="section-heading"><h3>History</h3><span className="muted">{insight.totalHistoryRows} workouts</span></div>
          {insight.history.map(row => <Button variant="tertiary" className="history-row" key={row.sessionId} onClick={async () => { const session = await api.getWorkout(row.sessionId); onSession?.(session); }}><span className="row-title"><strong>{row.sessionName}</strong><small>{dateLabel(row.date)} · {showSetCount(row.setCount)}</small></span><span>{displayKg(row.volumeKg, unit)}{row.partial ? ' *' : ''}</span><TrendingUp size={15} /></Button>)}
          {insight.history.length < insight.totalHistoryRows && <Button variant="tertiary" className="full-width" onClick={() => void moreHistory()} disabled={historyBusy}>{historyBusy ? 'Loading…' : 'Load more history'}</Button>}
          {insight.historyClears?.map(clear => <div className="exercise-history-cleared" role="status" key={clear.clearedAt}>Exercise history cleared on {dateLabel(clear.clearedAt)} · {showSetCount(clear.removedSets)} removed</div>)}
          {!insight.history.length && !insight.historyClears?.length && <p className="muted">No workout history for this exercise yet.</p>}
        </>}
      </div>
      <div className="modal-actions"><Button variant="tertiary" onClick={clearHistory} disabled={busy || !insight?.clearableSetCount}> <RotateCcw size={15} />Clear history</Button>{exercise.isCustom && !exercise.archived && !insight?.archived && <Button variant="destructive" onClick={() => setDeleteConfirm(true)} disabled={busy}><Trash2 size={15} />Delete custom exercise</Button>}<Button variant="primary" onClick={onClose}>Done</Button></div>
    </Modal>
    {clearPreview && <Modal title="Clear exercise history?" onClose={() => setClearPreview(null)}><div className="modal-body"><p>This permanently removes <strong>{clearPreview.affectedSets} sets</strong> from <strong>{clearPreview.affectedWorkouts} workouts</strong> and resets the exercise's progress records. The workouts themselves stay saved.</p><div className="modal-actions"><Button variant="tertiary" onClick={() => setClearPreview(null)}>Cancel</Button><Button variant="destructive" onClick={confirmClear} disabled={busy}>{busy ? 'Clearing…' : 'Clear history'}</Button></div></div></Modal>}
    {deleteConfirm && <Modal title="Delete custom exercise?" onClose={() => setDeleteConfirm(false)}><div className="modal-body"><p>This removes the exercise from future selections. Existing workout names, sets, records, and totals stay preserved; saved templates will mark the reference as deleted until you replace it.</p><div className="modal-actions"><Button variant="tertiary" onClick={() => setDeleteConfirm(false)}>Cancel</Button><Button variant="destructive" onClick={() => void deleteExercise()} disabled={busy}>{busy ? 'Deleting…' : 'Delete exercise'}</Button></div></div></Modal>}
  </>;
}

type ChartMetric = 'estimated1rm' | 'load' | 'volume' | 'reps';
function metricValue(point: ExerciseInsight['points'][number], metric: ChartMetric) {
  return metric === 'estimated1rm' ? point.estimated1RmKg : metric === 'load' ? point.loadKg : metric === 'volume' ? point.volumeKg : point.reps;
}
function chartMetricLabel(metric: ChartMetric) { return metric === 'estimated1rm' ? 'Estimated 1RM' : metric === 'load' ? 'Heaviest load' : metric === 'volume' ? 'Session volume' : 'Reps'; }
function formatMetricValue(value: number | null, metric: ChartMetric, unit: 'kg' | 'lb') { return value == null ? 'Unavailable' : metric === 'reps' ? `${value} reps` : displayKg(value, unit); }
