import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Exercise, ProgramSummary, Template, TemplateExercise } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { ExerciseLibrary } from './Exercises';

/// Swaps one exercise in the active program, for this workout or the rest of its phase.
export function ProgramSwapModal({ program, target, detail, exercises, onClose, onApplied }: {
  program: ProgramSummary;
  target: { template: Template; exercise: TemplateExercise };
  detail: Template[] | null;
  exercises: Exercise[];
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [scope, setScope] = useState<'slot' | 'phase'>('slot');
  const [choice, setChoice] = useState<Exercise | null>(null);
  const [confirmPhase, setConfirmPhase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { template, exercise } = target;
  const inPhase = (item: Template) => item.phaseId === template.phaseId || (item.phase === template.phase && item.block === template.block);
  const hasPhase = program.phases?.some(phase => phase.id === template.phaseId || (phase.name === template.phase && phase.block === template.block));
  const blocked = busy || (scope === 'phase' && !confirmPhase);

  async function run(apply: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await apply(); await onApplied(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not swap this exercise.'); }
    finally { setBusy(false); }
  }

  return <Modal title={`Swap ${exercise.name}`} onClose={onClose}>
    <div className="modal-body"><p className="source">Reps, sets, RIR, rest, tempo, warm-ups, notes, and source provenance stay with the slot. Loads are recalculated when the workout starts.</p>
      {template.isLegacyBaseline && <p className="muted small-copy">Restores to current saved version (earlier history unavailable)</p>}
      {hasPhase && <label className="field">Apply to<Select name="swap-scope-select" value={scope} onChange={value => { setScope(value as 'slot' | 'phase'); setConfirmPhase(false); }} ariaLabel="Apply swap scope" options={[{ value: 'slot', label: 'This workout only' }, { value: 'phase', label: 'Remaining workouts in this phase' }]} /></label>}
      {scope === 'phase' && <><div className="preview-card"><strong>Preview</strong><p>{detail?.filter(item => inPhase(item) && !program.completedTemplateIds.includes(item.id) && !(program.skippedTemplateIds ?? []).includes(item.id)).map(item => item.name).join(', ') || 'No remaining workouts in this phase.'}</p></div><label className="checkbox-row"><input id="confirm-phase-swap" name="confirm-phase-swap" type="checkbox" checked={confirmPhase} onChange={event => setConfirmPhase(event.target.checked)} />Apply this replacement to the previewed remaining workouts only.</label></>}
      <ExerciseLibrary action="swap" exercises={exercises} exclude={[]}
        currentExerciseId={exercise.exerciseId}
        preferredNames={exercise.substitutions}
        onSelect={id => setChoice(exercises.find(item => item.id === id) ?? null)} />
      {choice && <p className="source">Selected replacement: <strong>{choice.name}</strong></p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="modal-actions">
      {exercise.canRestore && <Button variant="tertiary" disabled={blocked} onClick={() => void run(() => api.restoreTemplateSubstitution(template.id, {
        templateExerciseId: exercise.id, slotKey: exercise.slotKey ?? undefined, scope, revision: template.revision, idempotencyId: crypto.randomUUID()
      }))}><RotateCcw size={14} />Restore default</Button>}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!choice || blocked} onClick={() => {
        if (!choice) return;
        void run(() => api.substituteTemplateExercise(template.id, {
          templateExerciseId: exercise.id, slotKey: exercise.slotKey ?? undefined, replacementExerciseId: choice.id,
          replacementName: choice.name, scope, revision: template.revision, idempotencyId: crypto.randomUUID()
        }));
      }}>Apply swap</Button>
    </div>
  </Modal>;
}
