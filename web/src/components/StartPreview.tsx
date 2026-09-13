import { Clock3, Dumbbell, ListChecks, Play } from 'lucide-react';
import type { Template } from '../types';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

/// Shown before a workout starts so the plan can be checked, and backed out of, without
/// creating a session on the server.
export function StartPreview({ template, busy, onCancel, onConfirm }: {
  template: Template; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const totalSets = template.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const rest = template.exercises.flatMap(e => e.sets).map(s => s.restSeconds).filter((s): s is number => s !== null);
  const typicalRest = rest.length ? Math.round(rest.reduce((a, b) => a + b, 0) / rest.length) : null;
  const unmapped = template.exercises.filter(e => !e.exerciseId).length;

  return <Modal title={`Start ${template.name}?`} onClose={onCancel} wide>
    <div className="workout-summary">
      <span><Dumbbell size={16} />{template.exercises.length} {template.exercises.length === 1 ? 'exercise' : 'exercises'}</span>
      <span><ListChecks size={16} />{totalSets} {totalSets === 1 ? 'set' : 'sets'}</span>
      {typicalRest !== null && <span><Clock3 size={16} />{typicalRest}s rest</span>}
    </div>
    <div className="modal-body">
      {template.focus && <p>{template.focus}</p>}
      {template.note && <p className="note-block">{template.note}</p>}
      <div className="preview-list">
        {template.exercises.map((exercise, index) => <div className="preview-row" key={exercise.id}>
          <span className="routine-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="preview-name">
            <strong>{exercise.name}</strong>
            {!exercise.exerciseId && <span className="tiny-label warn">NOT IN LIBRARY</span>}
            {exercise.note && <small>{exercise.note}</small>}
          </div>
          <div className="preview-sets">
            {exercise.sets.map((set, setIndex) => <span key={setIndex}>
              {showReps(set)} reps{set.targetRpe !== null ? ` @ RPE ${set.targetRpe}` : ''}{set.loadText ? ` · ${set.loadText}` : ''}
            </span>)}
          </div>
        </div>)}
      </div>
      {unmapped > 0 && <p className="muted small-copy">{unmapped} {unmapped === 1 ? 'exercise is' : 'exercises are'} not linked to the library. You can still log {unmapped === 1 ? 'it' : 'them'}; previous performance is matched by name instead.</p>}
      <p className="muted small-copy">Your last weights and reps are filled in once you start. Nothing is recorded until you log a set.</p>
    </div>
    <div className="modal-actions">
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" disabled={busy} onClick={onConfirm}>
        <Play size={16} fill="currentColor" />{busy ? 'Starting…' : 'Start workout'}
      </Button>
    </div>
  </Modal>;
}
