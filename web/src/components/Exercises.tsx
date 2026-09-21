import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Dumbbell, Library, Link2, Plus, Search, X, Trash2, RotateCcw, TrendingUp } from 'lucide-react';
import type { Exercise, ExerciseClearPreview, ExerciseInsight, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { ChipScroller } from './ui/ChipScroller';

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
  const [source, setSource] = useState<'all' | 'custom'>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const muscles = ['All muscles', ...new Map(exercises.flatMap(e => [e.muscle, ...(e.secondaryMuscles ?? [])])
    .filter(Boolean).map(value => [value.toLowerCase(), value] as const)).values()];
  const current = currentExerciseId ? exercises.find(e => e.id === currentExerciseId) : undefined;
  const excluded = new Set([...exclude, ...(currentExerciseId ? [currentExerciseId] : [])]);
  const filtered = exercises.filter(e => !excluded.has(e.id)
    && (source === 'all' || e.isCustom)
    && (muscle === 'All muscles' || [e.muscle, ...(e.secondaryMuscles ?? [])].some(value => value.toLowerCase() === muscle.toLowerCase()))
    && `${e.name} ${e.equipment} ${e.muscle} ${(e.secondaryMuscles ?? []).join(' ')} ${e.movementPattern ?? ''} ${e.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const ordered = [...filtered].sort((a, b) => exerciseRank(a, current, preferredNames) - exerciseRank(b, current, preferredNames)
    || a.name.localeCompare(b.name));
  const actionLabel = action === 'swap' ? 'Swap' : action === 'map' ? 'Map' : 'Add';
  const ActionIcon = action === 'add' ? Plus : action === 'swap' ? ArrowLeftRight : Link2;

  if (!exercises.length) return <>
    {!onSelect && <div className="page-heading"><h1>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="empty-message">
      <Library size={32} />
      <h3>No exercises available</h3>
      <p>The shared exercise library has not been loaded yet.</p>
    </div>
    {createOpen && <CustomExerciseModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await onChanged?.(); }} />}
  </>;

  return <div>
    {!onSelect && <div className="page-heading"><h1>Exercises</h1><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Create exercise</Button></div>}
    <div className="search-row">
      <label className="search-box">
        <Search size={18} />
        <input name="exercise-search" aria-label="Search exercises" placeholder="Search exercises or equipment…" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <Button presentation="plain" className="search-clear-btn" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></Button>}
      </label>
      {!onSelect && <div className="exercise-source-toggle" role="group" aria-label="Filter exercise source">
        <Button presentation="plain" className={`filter-chip ${source === 'all' ? 'active' : ''}`} onClick={() => setSource('all')}>All exercises</Button>
        <Button presentation="plain" className={`filter-chip ${source === 'custom' ? 'active' : ''}`} onClick={() => setSource('custom')}>Custom</Button>
      </div>}
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
    <div className={onSelect ? 'picker-list' : 'exercise-grid'}>{ordered.map(e =>
      onSelect ? (
        <article className="panel picker-card" key={e.id}>
          <div className="picker-card-info">
            <div className="picker-card-header">
              <span className="picker-exercise-icon" aria-hidden="true"><Dumbbell size={16} /></span>
              <h3>{e.name}</h3>
            </div>
            <div className="picker-tags">
              {e.isCustom && <span className="pill pill-muted">Custom</span>}
              <span className="pill pill-accent picker-muscle-tag">{e.muscle || 'Full body'}</span>
              {(e.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={`${e.id}-${secondary}`}>{secondary}</span>)}
              <span className="pill">{e.equipment || 'General'}</span>
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
            <div className="picker-tags">
              {e.isCustom && <span className="pill pill-muted">Custom</span>}
              <span className="pill pill-accent">{e.muscle || 'Full body'}</span>
              {(e.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={`${e.id}-${secondary}`}>{secondary}</span>)}
              <span className="pill">{e.equipment || 'General'}</span>
            </div>
          </div>
          <div className="exercise-card-body">
            <h3>{e.name}</h3>
            {e.cue && <p>{e.cue}</p>}
          </div>
        </article>
      ))}
    </div>
    {!filtered.length && <p className="empty-message">No matching exercises.</p>}
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

function CustomExerciseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(''); const [muscle, setMuscle] = useState(''); const [equipment, setEquipment] = useState('');
  const [secondaryMuscles, setSecondaryMuscles] = useState('');
  const [cue, setCue] = useState(''); const [loadModel, setLoadModel] = useState('external'); const [loadStepKg, setLoadStepKg] = useState('2.5');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!name.trim()) { setError('Exercise name is required.'); return; }
    const step = Number(loadStepKg); if (!Number.isFinite(step) || step < 0 || step > 50) { setError('Load increment must be between 0 and 50 kg.'); return; }
    setBusy(true);
    const secondary = [...new Set(secondaryMuscles.split(',').map(value => value.trim()).filter(Boolean))];
    try { await api.createCustomExercise({ name: name.trim(), muscle, secondaryMuscles: secondary, equipment, cue, loadStepKg: step, loadModel }); await onCreated(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not create the exercise.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Create custom exercise" onClose={onClose}>
    <form className="modal-body" noValidate onSubmit={submit}>
      <Field name="custom-exercise-name" label="Name" value={name} onChange={e => setName(e.target.value)} maxLength={160} autoFocus />
      <div className="form-grid-two"><Field name="custom-exercise-muscle" label="Primary muscle" value={muscle} onChange={e => setMuscle(e.target.value)} maxLength={80} /><Field name="custom-exercise-equipment" label="Equipment" value={equipment} onChange={e => setEquipment(e.target.value)} maxLength={80} /></div>
      <Field name="custom-exercise-secondary-muscles" label="Secondary muscles (comma-separated)" value={secondaryMuscles} onChange={e => setSecondaryMuscles(e.target.value)} maxLength={320} />
      <TextAreaField name="custom-exercise-cue" label="Instructions (optional)" value={cue} onChange={e => setCue(e.target.value)} maxLength={1000} />
      <div className="form-grid-two"><label className="field"><span>Load model</span><Select name="custom-exercise-load-model" label="Load model" value={loadModel} onChange={val => setLoadModel(val as string)} options={[{ value: 'external', label: 'External load' }, { value: 'full_bodyweight', label: 'Full bodyweight' }, { value: 'bodyweight_context_only', label: 'Bodyweight context only' }, { value: 'reps_only', label: 'Reps only' }]} /></label><Field name="custom-exercise-load-step" label="Load increment (kg)" type="number" min="0" max="50" step="0.5" value={loadStepKg} onChange={e => setLoadStepKg(e.target.value)} /></div>
      {error && <div className="error-text" role="alert">{error}</div>}
      <div className="modal-actions"><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create exercise'}</Button></div>
    </form>
  </Modal>;
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
        </div>
        {exercise.cue && <p className="muted">{exercise.cue}</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {!insight && !error && <div className="skeleton detail-loading" aria-label="Loading exercise details" />}
        {insight && <>
          <div className="detail-record-grid"><div className="stat-card"><span className="stat-label">Estimated 1RM</span><strong>{displayKg(insight.estimated1RmKg, unit)}</strong><small>{dateLabel(insight.estimated1RmDate)}</small></div><div className="stat-card"><span className="stat-label">Heaviest load</span><strong>{displayKg(insight.heaviestKg, unit)}</strong><small>{insight.heaviestReps ? `${insight.heaviestReps} reps · ` : ''}{dateLabel(insight.heaviestDate)}</small></div><div className="stat-card"><span className="stat-label">Largest set volume</span><strong>{displayKg(insight.largestSetVolumeKg, unit)}</strong><small>{dateLabel(insight.largestSetVolumeDate)}</small></div><div className="stat-card"><span className="stat-label">Largest session volume</span><strong>{displayKg(insight.largestSessionVolumeKg, unit)}</strong><small>{dateLabel(insight.largestSessionVolumeDate)}</small></div><div className="stat-card"><span className="stat-label">Rep PR</span><strong>{insight.repPr ?? '—'}</strong><small>{dateLabel(insight.repPrDate)}</small></div><div className="stat-card"><span className="stat-label">Sessions</span><strong>{insight.sessions}</strong><small>completed workouts</small></div><div className="stat-card"><span className="stat-label">Last performed</span><strong>{dateLabel(insight.lastPerformedDate)}</strong><small>{insight.setCount} working sets</small></div></div>
          <div className="detail-resistance-records" aria-label="Resistance records">{insight.externalLoadPrKg != null && <span>External load PR <strong>{displayKg(insight.externalLoadPrKg, unit)}</strong></span>}{insight.addedLoadPrKg != null && <span>Added load PR <strong>{displayKg(insight.addedLoadPrKg, unit)}</strong></span>}{insight.assistanceReductionPrKg != null && <span>Lowest assistance <strong>{displayKg(insight.assistanceReductionPrKg, unit)}</strong></span>}{insight.systemLoadPrKg != null && <span>System load PR <strong>{displayKg(insight.systemLoadPrKg, unit)}</strong></span>}</div>
          <div className="section-heading"><h3>Progress</h3><div className="detail-selectors"><label className="field"><span>Metric</span><Select name="progress-metric-select" label="Progress metric" value={metric} onChange={val => setMetric(val as ChartMetric)} options={[{ value: 'estimated1rm', label: 'Estimated 1RM' }, { value: 'load', label: 'Heaviest load' }, { value: 'volume', label: 'Session volume' }, { value: 'reps', label: 'Reps' }]} /></label><label className="field"><span>Range</span><Select name="progress-range-select" label="Progress range" value={range} onChange={val => setRange(val as string)} options={[{ value: '1m', label: 'Last month' }, { value: '3m', label: 'Last 3 months' }, { value: '6m', label: 'Last 6 months' }, { value: 'all', label: 'All time' }]} /></label></div></div>
          <div className="exercise-chart" role="img" aria-label={`${chartMetricLabel(metric)} progress chart`}><div className="exercise-chart-bars">{insight.points.length ? insight.points.map(point => { const value = metricValue(point, metric); return <div className="exercise-chart-point" key={`${point.sessionId}-${point.date}`} aria-label={`${dateLabel(point.date)}: ${formatMetricValue(value, metric, unit)}`}><i style={{ height: `${Math.max(4, Math.min(100, ((value ?? 0) / chartMax) * 100))}%` }} /><small>{dateLabel(point.date)}</small></div>; }) : <span className="muted">No completed working sets in this range.</span>}</div></div>
          <div className="chart-table" role="table" aria-label="Exercise progress table"><div className="chart-table-row chart-table-head" role="row"><span>Date</span><span>1RM</span><span>Load</span><span>Volume</span><span>Reps</span></div>{insight.points.map(point => <div className="chart-table-row" role="row" key={`row-${point.sessionId}-${point.date}`}><span>{dateLabel(point.date)}</span><span>{displayKg(point.estimated1RmKg, unit)}</span><span>{displayKg(point.loadKg, unit)}</span><span>{displayKg(point.volumeKg, unit)}{point.partial ? ' *' : ''}</span><span>{point.reps ?? '—'}</span></div>)}</div>
          {insight.partialVolume && <p className="muted detail-note">* Volume is partial because one or more logged loads were unknown.</p>}
          <div className="section-heading"><h3>History</h3><span className="muted">{insight.totalHistoryRows} workouts</span></div>
          {insight.history.map(row => <Button variant="tertiary" className="history-row" key={row.sessionId} onClick={async () => { const session = await api.getWorkout(row.sessionId); onSession?.(session); }}><span className="row-title"><strong>{row.sessionName}</strong><small>{dateLabel(row.date)} · {row.setCount} sets</small></span><span>{displayKg(row.volumeKg, unit)}{row.partial ? ' *' : ''}</span><TrendingUp size={15} /></Button>)}
          {insight.history.length < insight.totalHistoryRows && <Button variant="tertiary" className="full-width" onClick={() => void moreHistory()} disabled={historyBusy}>{historyBusy ? 'Loading…' : 'Load more history'}</Button>}
          {insight.historyClears?.map(clear => <div className="exercise-history-cleared" role="status" key={clear.clearedAt}>Exercise history cleared on {dateLabel(clear.clearedAt)} · {clear.removedSets} sets removed</div>)}
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
