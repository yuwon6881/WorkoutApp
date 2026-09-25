import { useRef, useState, type FormEvent } from 'react';
import type { CustomExerciseCreated, ExerciseCategory } from '../types';
import { ApiError, api } from '../lib/api';
import { getExerciseCategory } from '../lib/exerciseCategory';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';

export function CustomExerciseModal({ onClose, onCreated, initialName = '', onExerciseCreated }: {
  onClose: () => void;
  onCreated?: () => Promise<void> | void;
  initialName?: string;
  onExerciseCreated?: (exercise: CustomExerciseCreated) => Promise<void> | void;
}) {
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [category, setCategory] = useState<ExerciseCategory>('Free Weights');
  const [secondaryMuscles, setSecondaryMuscles] = useState('');
  const [cue, setCue] = useState('');
  const [loadModel, setLoadModel] = useState('external');
  const [loadStepKg, setLoadStepKg] = useState('2.5');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdExercise, setCreatedExercise] = useState<CustomExerciseCreated | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if (!createdExercise && !name.trim()) {
      setError('Exercise name is required.');
      return;
    }
    const step = Number(loadStepKg);
    if (!createdExercise && (!Number.isFinite(step) || step < 0 || step > 50)) {
      setError('Load increment must be between 0 and 50 kg.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    const secondary = [...new Set(secondaryMuscles.split(',').map(value => value.trim()).filter(Boolean))];
    let createdDuringAttempt = false;
    try {
      const created = createdExercise ?? await api.createCustomExercise({
        name: name.trim(), muscle, secondaryMuscles: secondary, equipment, category, cue,
        loadStepKg: step, loadModel
      });
      if (!createdExercise) {
        setCreatedExercise(created);
        createdDuringAttempt = true;
      }
      await onExerciseCreated?.(created);
      await onCreated?.();
    } catch (failure) {
      const alreadyCreated = createdDuringAttempt || createdExercise !== null;
      if (alreadyCreated) {
        const reason = failure instanceof ApiError ? failure.message : 'The mapping request did not finish.';
        setError(`The exercise was created, but the import could not map it. ${reason} Retry mapping; the same exercise will be reused.`);
      } else {
        setError(failure instanceof ApiError ? failure.message : 'The exercise could not be created. Check your connection and try again.');
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Modal title={createdExercise ? 'Finish mapping exercise' : 'Create custom exercise'} onClose={() => !busy && onClose()}>
    <form className="modal-body" noValidate onSubmit={submit}>
      <Field name="custom-exercise-name" label="Name" value={name} onChange={event => setName(event.target.value)} maxLength={160} autoFocus disabled={!!createdExercise} />
      <div className="form-grid-two">
        <Field name="custom-exercise-muscle" label="Primary muscle" value={muscle} onChange={event => setMuscle(event.target.value)} maxLength={80} disabled={!!createdExercise} />
        <Field name="custom-exercise-equipment" label="Equipment" value={equipment} onChange={event => {
          setEquipment(event.target.value);
          setCategory(getExerciseCategory({ equipment: event.target.value, loadModel }));
        }} maxLength={80} disabled={!!createdExercise} />
      </div>
      <Field name="custom-exercise-secondary-muscles" label="Secondary muscles (comma-separated)" value={secondaryMuscles} onChange={event => setSecondaryMuscles(event.target.value)} maxLength={320} disabled={!!createdExercise} />
      <TextAreaField name="custom-exercise-cue" label="Instructions (optional)" value={cue} onChange={event => setCue(event.target.value)} maxLength={1000} disabled={!!createdExercise} />
      <div className="form-grid-two">
        <label className="field"><span>Category</span><Select name="custom-exercise-category" label="Category" value={category} onChange={value => setCategory(value as ExerciseCategory)} disabled={!!createdExercise} options={[
          { value: 'Free Weights', label: 'Free Weights' }, { value: 'Machine', label: 'Machine' }, { value: 'Body Weight', label: 'Body Weight' }
        ]} /></label>
        <label className="field"><span>Load model</span><Select name="custom-exercise-load-model" label="Load model" value={loadModel} onChange={value => {
          setLoadModel(value as string);
          setCategory(getExerciseCategory({ equipment, loadModel: value as string }));
        }} disabled={!!createdExercise} options={[
          { value: 'external', label: 'External load' }, { value: 'full_bodyweight', label: 'Full bodyweight' },
          { value: 'bodyweight_context_only', label: 'Bodyweight context only' }, { value: 'reps_only', label: 'Reps only' }
        ]} /></label>
      </div>
      <Field name="custom-exercise-load-step" label="Load increment (kg)" type="number" min="0" max="50" step="0.5" value={loadStepKg} onChange={event => setLoadStepKg(event.target.value)} disabled={!!createdExercise} />
      {error && <div className="error-text" role="alert">{error}</div>}
      <div className="modal-actions">
        <Button variant="tertiary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? (createdExercise ? 'Mapping…' : 'Creating…') : createdExercise ? 'Retry mapping' : 'Create and map exercise'}
        </Button>
      </div>
    </form>
  </Modal>;
}
