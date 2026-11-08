import { forwardRef } from 'react';
import { AlertTriangle, ChevronRight, Info } from 'lucide-react';
import type { ImportDraft, ImportView } from '../types';
import type { AttentionRow, ImportIssueTarget } from '../lib/importAttentionRows';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import { ImportReviewIssues } from './ImportReviewIssues';
import { GymSwitcher } from './GymSwitcher';
import { useGymAvailabilityCheck } from '../lib/gymAvailability';
import './ImportReview.css';

/// The head of the review step: the program name, what could not be linked to the catalog, and
/// the items that block creating the program.
export const ImportReviewPanel = forwardRef<HTMLElement, {
  view: ImportView;
  draft: ImportDraft;
  attentionRows: AttentionRow[];
  onNameChange: (name: string) => void;
  onNameCommit: () => void;
  onFocusIssue: (target: ImportIssueTarget) => void;
}>(function ImportReviewPanel({ view, draft, attentionRows, onNameChange, onNameCommit, onFocusIssue }, ref) {
  const checkGym = useGymAvailabilityCheck();
  // Match the editor’s occurrence groups so each replacement can reach its repeats.
  const linked = new Map<string, { dayId: string; lineId: string; name: string; exerciseId: string }>();
  for (const day of draft.workouts) {
    for (const exercise of day.exercises) {
      const key = exercise.movementKey || `name\u001f${exercise.sourceName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
      if (exercise.exerciseId && !linked.has(key)) {
        linked.set(key, { dayId: day.lineId, lineId: exercise.lineId, name: exercise.sourceName, exerciseId: exercise.exerciseId });
      }
    }
  }
  const unavailable = [...linked.values()].flatMap(exercise => {
    const availability = checkGym(exercise.exerciseId);
    return availability.available ? [] : [{ ...exercise, availability }];
  });
  return (
    <section className="panel irev-panel" ref={ref}>
      <div className="irev-header">
        <div className="irev-header-title-row">
          <h2>Review</h2>
          {attentionRows.length === 0 ? (
            <span className="irev-status-chip irev-status-chip--ready">
              <span>Ready to create</span>
            </span>
          ) : (
            <span className="irev-status-chip irev-status-chip--attention">
              <AlertTriangle size={14} />
              <span>{attentionRows.length} to resolve</span>
            </span>
          )}
        </div>
        {!view.acceptable && (
          <p className="muted irev-notice-copy" role="status">
            The program can be created after every review item is resolved.
          </p>
        )}
      </div>

      <Field
        label="Program name"
        name="import-program-name"
        value={draft.programName}
        onChange={event => onNameChange(event.target.value)}
        onBlur={onNameCommit}
        className="irev-name-field"
      />

      {view.unresolved.length > 0 && (
        <div className="irev-unresolved-banner" role="status">
          <Info size={16} className="irev-unresolved-icon" />
          <span className="irev-unresolved-text">
            {view.unresolved.length} exercise slot{view.unresolved.length === 1 ? ' is' : 's are'} not linked to the catalog. Unmapped names stay verbatim and can still be logged.
          </span>
        </div>
      )}

      <GymSwitcher />
      {unavailable[0] && (
        <section className="irev-gym-section" aria-label="Exercises unavailable at your gym">
          <div className="irev-unresolved-banner irev-gym-banner" role="status">
            <AlertTriangle size={16} className="irev-unresolved-icon irev-gym-icon" />
            <span className="irev-unresolved-text">
              {unavailable.length} {unavailable.length === 1 ? 'movement is' : 'movements are'} unavailable at your gym, <strong>{unavailable[0].availability.gymName}</strong>.
              Choose an exercise to replace it here, or swap it once a workout starts.
            </span>
          </div>
          <div className="irev-gym-list">
            {unavailable.map(item => (
              <div className="irev-gym-row" key={item.lineId}>
                <span><strong>{item.name}</strong><br /><span className="muted">{item.availability.marked ? 'Marked unavailable' : `Missing: ${item.availability.missing.join(', ')}`}</span></span>
                <Button variant="secondary" className="irev-action-btn" aria-label={`Replace ${item.name}`} onClick={() => onFocusIssue({ workoutLineId: item.dayId, exerciseLineId: item.lineId, targetField: 'library' })}>
                  Replace <ChevronRight size={14} />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ImportReviewIssues rows={attentionRows} onFocusIssue={onFocusIssue} />
    </section>
  );
});
