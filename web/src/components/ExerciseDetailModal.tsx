import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Exercise, ExerciseInsight, Unit } from '../types';
import { ApiError, api } from '../lib/api';
import { canEnterPerSide } from '../lib/equipmentGroups';
import { getExerciseCategory, informativeEquipment } from '../lib/exerciseCategory';
import { loadAdjustable } from '../lib/exerciseLoads';
import { chartMetricLabel, defaultChartMetric, formatMetricValue, metricValue, showEstimate, type ChartMetric } from '../lib/exerciseMetrics';
import { showSetCount, showVolume } from '../lib/training';
import { showExerciseWeight, weightBasisDescription, type WithWeightBasis } from '../lib/weightBasis';
import { ExerciseGymAvailability } from './ExerciseGymAvailability';
import { ExerciseHistory } from './ExerciseHistory';
import { ExerciseHistoryClearing } from './ExerciseHistoryClearing';
import { ExerciseLoadSettings } from './ExerciseLoadSettings';
import { ExerciseProgressChart } from './ExerciseProgressChart';
import { ExerciseProgressTable } from './ExerciseProgressTable';
import { OneRepMaxSettings } from './OneRepMaxSettings';
import { useExerciseInsight } from './useExerciseInsight';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SegmentedControl } from './ui/SegmentedControl';
import { Select } from './ui/Select';
import './ExerciseDetail.css';

type DetailTab = 'progress' | 'history';

const metricOptions: { value: ChartMetric; label: string }[] = [
  { value: 'estimated1rm', label: 'Estimated 1RM' },
  { value: 'load', label: 'Heaviest load' },
  { value: 'volume', label: 'Session volume' },
  { value: 'reps', label: 'Reps' }
];

const rangeOptions = [
  { value: '1m', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: 'all', label: 'All time' }
];

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function typeLabel(exercise: Exercise) {
  if (exercise.archived && exercise.isCustom) return 'Deleted custom exercise';
  return exercise.isCustom ? 'Custom exercise' : exercise.muscle || 'Full body';
}

/// Both tabs stay mounted and the inactive one is hidden, so going to History and back does not
/// reload the weight settings or collapse the history rows that were opened.
export function ExerciseDetailModal({ exercise, unit, onClose, onChanged }: {
  exercise: Exercise;
  unit: Unit;
  onClose: () => void;
  onChanged?: () => Promise<void> | void;
}) {
  const [detailTab, setDetailTab] = useState<DetailTab>('progress');
  const { insight, range, setRange, error, setError, rangeLoading, historyBusy, moreHistory, historyCleared } = useExerciseInsight(exercise.id, onChanged);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const customDeletable = exercise.isCustom && !exercise.archived && !insight?.archived;
  const adjustable = loadAdjustable(exercise);
  const editable = adjustable && !exercise.archived;
  const hasHistory = Boolean(insight && insight.totalHistoryRows > 0);
  const onProgress = detailTab === 'progress';

  async function deleteExercise() {
    setBusy(true);
    try {
      await api.deleteCustomExercise(exercise.id);
      setDeleteConfirm(false);
      await onChanged?.();
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not delete this custom exercise.');
    } finally { setBusy(false); }
  }

  return <>
    <Modal title={exercise.name} onClose={onClose} wide>
      <div className="modal-body exercise-detail-modal">
        <SegmentedControl label="Exercise detail view" value={detailTab} onChange={setDetailTab}
          options={[{ value: 'progress', label: 'Progress' }, { value: 'history', label: 'History' }]} />

        <div className="exercise-detail-panel" hidden={!onProgress}>
          <div className="exercise-detail-meta">
            <span className="pill pill-accent">{typeLabel(exercise)}</span>
            {(exercise.secondaryMuscles ?? []).map(secondary => <span className="pill pill-muted" key={secondary}>{secondary}</span>)}
            {informativeEquipment(exercise) && <span className="pill pill-equipment">{informativeEquipment(exercise)}</span>}
            <span className="pill pill-category">{getExerciseCategory(exercise)}</span>
          </div>
          {!exercise.archived && <ExerciseGymAvailability exerciseId={exercise.id} requires={exercise.requires} />}
          {editable && <ExerciseLoadSettings key={exercise.id} exerciseId={exercise.id} exerciseName={exercise.name} unit={unit}
            perSide={canEnterPerSide(exercise)} onChanged={onChanged} />}
          {editable && <OneRepMaxSettings key={`1rm-${exercise.id}`} exerciseId={exercise.id} exerciseName={exercise.name} unit={unit} />}
          {adjustable && <p className="muted">{weightBasisDescription(exercise)}</p>}
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {!insight && !error && <div className="skeleton detail-loading" aria-label="Loading exercise details" />}
        {insight && !hasHistory && <p className="muted">No workout history yet. Complete a workout to see progress here.</p>}

        {insight && hasHistory && <div className="exercise-detail-panel" hidden={!onProgress} aria-busy={rangeLoading || undefined}>
          <ProgressPanel insight={insight} unit={unit} basis={{ weightBasis: insight.weightBasis ?? exercise.weightBasis }}
            range={range} onRange={setRange} />
        </div>}

        <div className="exercise-detail-panel" hidden={onProgress}>
          {insight && hasHistory && <>
            <div className="section-heading exercise-history-heading">
              <h3>History</h3>
              <span className="exercise-history-count">{insight.totalHistoryRows} {insight.totalHistoryRows === 1 ? 'workout' : 'workouts'}</span>
            </div>
            <ExerciseHistory rows={insight.history} exerciseId={exercise.id} unit={unit} />
            {insight.history.length < insight.totalHistoryRows && <Button variant="tertiary" className="full-width"
              onClick={() => void moreHistory()} disabled={historyBusy || rangeLoading}>{historyBusy ? 'Loading…' : 'Load more history'}</Button>}
            {!insight.history.length && !insight.historyClears?.length && <p className="muted">No workout history for this exercise yet.</p>}
          </>}
          {insight?.historyClears?.map(clear => <div className="exercise-history-cleared" role="status" key={clear.clearedAt}>
            Exercise history cleared on {dateLabel(clear.clearedAt)} · {showSetCount(clear.removedSets)} removed
          </div>)}
          {Boolean(insight?.clearableSetCount) && <ExerciseHistoryClearing exerciseId={exercise.id}
            clearableSets={insight!.clearableSetCount} onCleared={historyCleared} />}
        </div>
      </div>
      <div className={`modal-actions ${customDeletable ? '' : 'dismiss-only'}`.trim()}>
        {customDeletable && <Button variant="destructive" onClick={() => setDeleteConfirm(true)} disabled={busy}>
          <Trash2 size={15} />Delete custom exercise
        </Button>}
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
    {deleteConfirm && <Modal title="Delete custom exercise?" onClose={() => setDeleteConfirm(false)}>
      <div className="modal-body">
        <p>This removes the exercise from future selections. Existing workout names, sets, records, and totals stay preserved; saved templates will mark the reference as deleted until you replace it.</p>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => void deleteExercise()} disabled={busy}>{busy ? 'Deleting…' : 'Delete exercise'}</Button>
        </div>
      </div>
    </Modal>}
  </>;
}

function ProgressPanel({ insight, unit, basis, range, onRange }: {
  insight: ExerciseInsight;
  unit: Unit;
  basis: WithWeightBasis;
  range: string;
  onRange: (range: string) => void;
}) {
  const [selectedMetric, setSelectedMetric] = useState<ChartMetric | null>(null);
  const metric = selectedMetric ?? defaultChartMetric(insight.points);
  const load = (kg: number | null | undefined) => showExerciseWeight(kg, unit, basis);
  const volume = (kg: number | null | undefined) => showVolume(kg ?? null, unit);

  return <>
    <div className="section-heading">
      <h3>Progress</h3>
      <div className="detail-selectors">
        <label className="field"><span>Metric</span>
          <Select name="progress-metric-select" label="Progress metric" value={metric}
            onChange={value => setSelectedMetric(value as ChartMetric)} options={metricOptions} />
        </label>
        {insight.totalHistoryRows > 1 && <label className="field"><span>Range</span>
          <Select name="progress-range-select" label="Progress range" value={range}
            onChange={value => onRange(value as string)} options={rangeOptions} />
        </label>}
      </div>
    </div>
    <ExerciseProgressChart label={`${chartMetricLabel(metric)} progress`}
      format={value => formatMetricValue(value, metric, unit, basis)}
      points={insight.points.map(point => ({ key: `${point.sessionId}-${point.date}`, date: dateLabel(point.date), value: metricValue(point, metric) }))} />
    {insight.points.length > 0 && <ExerciseProgressTable points={insight.points} formatDate={dateLabel}
      formatEstimate={kg => showEstimate(kg, unit, basis)} formatLoad={load} formatVolume={volume} />}
    {insight.partialVolume && insight.points.some(point => point.volumeKg != null)
      && <p className="muted detail-note">* Volume is partial because one or more logged loads were unknown.</p>}
    <div className="detail-record-grid">
      {/* A record with no logged load behind it (a rep-only movement) is left out, not shown as a dash. */}
      {insight.estimated1RmKg != null && <Record label="Estimated 1RM" value={showEstimate(insight.estimated1RmKg, unit, basis)}
        note={dateLabel(insight.estimated1RmDate)} />}
      {insight.heaviestKg != null && <Record label="Heaviest load" value={load(insight.heaviestKg)}
        note={`${insight.heaviestReps ? `${insight.heaviestReps} reps · ` : ''}${dateLabel(insight.heaviestDate)}`} />}
      {insight.largestSetVolumeKg != null && <Record label="Largest set volume" value={volume(insight.largestSetVolumeKg)}
        note={dateLabel(insight.largestSetVolumeDate)} />}
      {insight.largestSessionVolumeKg != null && <Record label="Largest session volume" value={volume(insight.largestSessionVolumeKg)}
        note={dateLabel(insight.largestSessionVolumeDate)} />}
      <Record label="Rep PR" value={insight.repPr ?? '—'} note={insight.repPr != null ? dateLabel(insight.repPrDate) : undefined} />
      <Record label="Sessions" value={insight.sessions > 0 ? insight.sessions : '—'} note={insight.sessions > 0 ? 'completed workouts' : undefined} />
      <Record label="Last performed" value={dateLabel(insight.lastPerformedDate)}
        note={insight.setCount > 0 ? `${insight.setCount} working sets` : undefined} />
    </div>
    <div className="detail-resistance-records" aria-label="Resistance records">
      {insight.externalLoadPrKg != null && <span>External load PR <strong>{load(insight.externalLoadPrKg)}</strong></span>}
      {insight.addedLoadPrKg != null && <span>Added load PR <strong>{load(insight.addedLoadPrKg)}</strong></span>}
      {insight.assistanceReductionPrKg != null && <span>Lowest assistance <strong>{load(insight.assistanceReductionPrKg)}</strong></span>}
      {insight.systemLoadPrKg != null && <span>System load PR <strong>{load(insight.systemLoadPrKg)}</strong></span>}
    </div>
  </>;
}

function Record({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="stat-card">
    <span className="stat-label">{label}</span>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </div>;
}
