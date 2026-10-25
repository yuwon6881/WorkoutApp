import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import type { Exercise, Template } from '../types';
import { api, ApiError } from '../lib/api';
import { templateToDraft } from '../lib/activeSlot';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import { ReadOnlyDay } from './ReadOnlyDay';
import { WorkoutDaySkeleton } from './WorkoutDaySkeleton';
import './ImportDaySheet.css';

export function WorkoutPreviewModal({ templateId, name, exercises, onClose, onStart }: {
  templateId: string;
  name: string;
  exercises: Exercise[];
  onClose: () => void;
  onStart: (id: string) => void;
}) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
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
      {template ? <>
        {template.note && <p className="muted small-copy">{template.note}</p>}
        <ReadOnlyDay day={templateToDraft(template)} exercises={exercises}
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
