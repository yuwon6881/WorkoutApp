import { useContext, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { Exercise, Template, Unit } from '../types';
import { lastPerformedLabel } from '../lib/lastPerformed';
import { estimateWorkoutMinutes } from '../lib/workoutEstimate';
import { useLastPerformed } from './useLastPerformed';
import { api, ApiError } from '../lib/api';
import { templateToDraft } from '../lib/activeSlot';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import { ReadOnlyDay } from './ReadOnlyDay';
import { WorkoutDaySkeleton } from './WorkoutDaySkeleton';
import { GymSwitcher } from './GymSwitcher';
import { GymAvailabilityContext, useGymAvailabilityCheck } from '../lib/gymAvailability';
import './ImportDaySheet.css';

export function WorkoutPreviewModal({ templateId, name, exercises, unit, defaultRestSeconds, onClose, onStart }: {
  templateId: string;
  unit: Unit;
  /** The account's rest when the plan names none, for the duration estimate. */
  defaultRestSeconds: number;
  name: string;
  exercises: Exercise[];
  onClose: () => void;
  onStart: (id: string) => void;
}) {
  const checkGym = useGymAvailabilityCheck();
  // Without the catalog every exercise would read as available, so the preview waits for it.
  const { requirementsReady = true } = useContext(GymAvailabilityContext);
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const lastPerformed = useLastPerformed(true);
  const day = useMemo(() => template ? templateToDraft(template) : null, [template]);
  const lastLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const catalog = new Map(exercises.map(exercise => [exercise.id, exercise]));
    for (const [id, last] of lastPerformed) {
      const label = lastPerformedLabel(last, unit, catalog.get(id) ?? {});
      if (label) labels.set(id, label);
    }
    return labels;
  }, [lastPerformed, exercises, unit]);
  const minutes = day ? estimateWorkoutMinutes(day.exercises, defaultRestSeconds) : null;
  const unavailable = (day?.exercises ?? []).map(exercise => checkGym(exercise.exerciseId)).filter(result => !result.available);
  useEffect(() => {
    const controller = new AbortController();
    setTemplate(null);
    setError('');
    api.getTemplate(templateId, controller.signal).then(value => {
      if (!controller.signal.aborted) setTemplate(value);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? failure.message : 'Workout details could not be loaded.');
    });
    return () => controller.abort();
  }, [templateId, retry]);

  return <Modal title={template?.name ?? name} wide className="day-detail-modal" onClose={onClose}>
    <div className="modal-body day-detail-modal-body">
      {template && day && requirementsReady ? <>
        {minutes !== null && <p className="muted small-copy workout-preview-estimate">About {minutes} min, at the planned rests</p>}
        {template.note && <p className="muted small-copy">{template.note}</p>}
        {/* Switching here makes the workout record that gym and follow its weights. */}
        <GymSwitcher />
        {unavailable[0] && !unavailable[0].available && <p className="workout-preview-gym-note small-copy" role="note">
          {unavailable.length === 1 ? '1 exercise needs' : `${unavailable.length} exercises need`} something {unavailable[0].gymName} does
          not have. You can swap {unavailable.length === 1 ? 'it' : 'them'} once the workout starts.
        </p>}
        <ReadOnlyDay day={day} exercises={exercises} lastLabels={lastLabels}
          selectedMuscle={selectedMuscle} onMuscleSelect={setSelectedMuscle} />
      </> : error ? <CardFeedback title="Could not load workout preview" message={error}
        action={{ label: 'Retry', onClick: () => setRetry(value => value + 1) }} />
        : <WorkoutDaySkeleton label="Loading workout preview…" />}
    </div>
    <div className="modal-actions">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!template || template.isRestDay} onClick={() => onStart(templateId)}>
        <Play size={14} fill="currentColor" />Start workout
      </Button>
    </div>
  </Modal>;
}
