import { forwardRef } from 'react';
import { AlertTriangle, Check, ChevronRight, HelpCircle, Info } from 'lucide-react';
import type { Exercise, ImportDraft, ImportView } from '../types';
import { applyImportOption, optionsAt } from '../lib/importOptions';
import { ImportUncertaintyOptions } from './ImportUncertaintyOptions';
import type { AttentionRow, ImportIssueTarget } from '../lib/importAttentionRows';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import { ImportReviewIssues } from './ImportReviewIssues';
import { GymSwitcher } from './GymSwitcher';
import { useGymAvailabilityCheck } from '../lib/gymAvailability';
import './ImportReview.css';
import './ImportUncertainty.css';

/// Decides which field or surface within an exercise to highlight when inspecting an uncertainty issue.
export function resolveUncertaintyTargetField(issue: {
  message: string;
  setIndex?: number | null;
  targetField?: string | null;
}): string | undefined {
  if (issue.targetField) return issue.targetField;
  if (issue.setIndex != null) {
    if (/\b(rpe|rir)\b/i.test(issue.message)) return 'targetRpe';
    if (/\breps?\b/i.test(issue.message)) return 'repMin';
    if (/\brest\b/i.test(issue.message)) return 'rest';
    return undefined;
  }
  if (/\brest\b/i.test(issue.message)) return 'rest';
  if (/\b(set count|working sets?|sets? prescription|sets?)\b/i.test(issue.message)) {
    return 'sets';
  }
  return undefined;
}

/// The head of the review step: the program name, what could not be linked to the catalog, and
/// the items that block creating the program.
export const ImportReviewPanel = forwardRef<HTMLElement, {
  view: ImportView;
  draft: ImportDraft;
  attentionRows: AttentionRow[];
  onNameChange: (name: string) => void;
  onNameCommit: () => void;
  onFocusIssue: (target: ImportIssueTarget) => void;
  acknowledgedUncertainty?: boolean;
  onAcknowledgeUncertainty?: (value: boolean) => void;
  busy?: boolean;
  /// The library, to name the movements the assistant offered, and what to do with the draft once one is chosen.
  exercises?: Exercise[];
  onApplyOption?: (next: ImportDraft) => void;
}>(function ImportReviewPanel({ view, draft, attentionRows, onNameChange, onNameCommit, onFocusIssue, acknowledgedUncertainty, onAcknowledgeUncertainty, busy, exercises = [], onApplyOption }, ref) {
  const checkGym = useGymAvailabilityCheck();
  const hasUncertainty = (view.reviewIssues ?? []).some(issue => issue.code === 'external_uncertainty');
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
          {attentionRows.length === 0 && (!hasUncertainty || acknowledgedUncertainty) ? (
            <span className="irev-status-chip irev-status-chip--ready">
              <span>Ready to create</span>
            </span>
          ) : (
            <span className="irev-status-chip irev-status-chip--attention">
              <AlertTriangle size={14} />
              <span>{attentionRows.length > 0 ? `${attentionRows.length} to resolve` : 'Review needed'}</span>
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
            {view.unresolved.length} exercise slot{view.unresolved.length === 1 ? ' is' : 's are'} not linked to the catalog. Link each one to a library exercise, or create a custom one, before creating the program.
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
      {hasUncertainty && (() => {
        const uncertaintyIssues = (view.reviewIssues ?? []).filter(issue => issue.code === 'external_uncertainty');
        return (
          <section className="irev-uncertainty" aria-label="Uncertain import details">
            <div className="irev-uncertainty-header">
              <div className="irev-uncertainty-title-group">
                <div className="irev-uncertainty-title-row">
                  <span className="irev-uncertainty-icon-badge" aria-hidden="true">
                    <HelpCircle size={16} />
                  </span>
                  <h3 className="irev-uncertainty-title">Uncertain details</h3>
                  <span className="pill irev-count-pill">
                    {uncertaintyIssues.length} {uncertaintyIssues.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <p className="muted irev-uncertainty-desc">
                  Values flagged for your review. Confirm them below before creating the program.
                </p>
              </div>
            </div>
            <ul className="irev-uncertainty-list">
              {uncertaintyIssues.map((issue, index) => {
                const colonIndex = issue.message.indexOf(': ');
                const hasColon = colonIndex > -1;
                const subject = hasColon ? issue.message.slice(0, colonIndex) : null;
                const reason = hasColon ? issue.message.slice(colonIndex + 2) : issue.message;
                const options = onApplyOption ? optionsAt(draft, issue) : [];
                return (
                  <li key={`${issue.exerciseLineId}-${issue.setIndex}-${index}`} className="irev-uncertainty-row" role="listitem">
                    <div className="irev-uncertainty-row-main">
                      <span className="irev-uncertainty-row-icon" aria-hidden="true">
                        <HelpCircle size={15} />
                      </span>
                      <div className="irev-uncertainty-row-body">
                        {subject ? (
                          <>
                            <div className="irev-uncertainty-row-title-line">
                              <strong className="irev-uncertainty-row-title">{subject}</strong>
                              {issue.sourcePage && (
                                <span className="pill irev-source-pill" aria-label={`Source page ${issue.sourcePage}`}>p.{issue.sourcePage}</span>
                              )}
                            </div>
                            <span className="irev-uncertainty-row-reason">{reason}</span>
                          </>
                        ) : (
                          <div className="irev-uncertainty-row-title-line">
                            <span className="irev-uncertainty-row-message">{issue.message}</span>
                            {issue.sourcePage && (
                              <span className="pill irev-source-pill" aria-label={`Source page ${issue.sourcePage}`}>p.{issue.sourcePage}</span>
                            )}
                          </div>
                        )}
                        {options.length > 0 && (
                          <ImportUncertaintyOptions options={options} library={exercises} busy={busy}
                            onChoose={option => { const next = applyImportOption(draft, issue, option, exercises); if (next) onApplyOption?.(next); }} />
                        )}
                      </div>
                    </div>
                    {issue.workoutLineId && issue.exerciseLineId && (
                      <div className="irev-uncertainty-row-action">
                        <Button
                          variant="secondary"
                          className="irev-action-btn irev-uncertainty-inspect-btn"
                          aria-label={`Inspect ${issue.message}`}
                          onClick={() => onFocusIssue({
                            workoutLineId: issue.workoutLineId,
                            exerciseLineId: issue.exerciseLineId,
                            setIndex: issue.setIndex,
                            sourcePage: issue.sourcePage,
                            targetField: resolveUncertaintyTargetField(issue)
                          })}
                        >
                          Inspect <ChevronRight size={14} />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className={`irev-uncertainty-confirm-card ${acknowledgedUncertainty ? 'is-confirmed' : ''}`}>
              <label className="irev-uncertainty-confirm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={Boolean(acknowledgedUncertainty)}
                  onChange={event => onAcknowledgeUncertainty?.(event.target.checked)}
                  className="irev-uncertainty-checkbox"
                />
                <span className="irev-uncertainty-confirm-text">I reviewed these uncertain details.</span>
              </label>
              <div className="irev-uncertainty-confirm-status" aria-hidden="true">
                {acknowledgedUncertainty ? (
                  <span className="irev-uncertainty-chip irev-uncertainty-chip--confirmed">
                    <Check size={13} /> Reviewed
                  </span>
                ) : (
                  <span className="irev-uncertainty-chip irev-uncertainty-chip--pending">
                    Confirmation required
                  </span>
                )}
              </div>
            </div>
          </section>
        );
      })()}
    </section>
  );
});
