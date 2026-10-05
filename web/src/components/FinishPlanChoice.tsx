import { Loader2 } from 'lucide-react';
import type { FinishPlanChoice as Choice, FinishPlanUpdate } from './useFinishPlanUpdate';
import './ExerciseScopeOptions.css';
import { CardFeedback } from './ui/CardFeedback';

const others = (count: number) => `Also ${count} other ${count === 1 ? 'occurrence' : 'occurrences'}`;

/// The finish dialog's offer to carry this workout's plan changes into the program. It appears only
/// when a changed movement recurs, and offers each wider reach only when it adds occurrences.
export function FinishPlanChoice({ update, disabled }: { update: FinishPlanUpdate; disabled: boolean }) {
  if (update.status === 'loading') return <p className="muted finish-plan-checking" role="status">
    <Loader2 size={14} className="spin" aria-hidden="true" />Checking your program for the same exercises…
  </p>;
  const { summary } = update;
  if (!summary) return update.error ? <div><CardFeedback message={update.error}
    action={{ label: 'Retry review', disabled, onClick: update.retry }} />
    <p className="muted">You can save just this workout, or retry reviewing program changes.</p>
    </div> : null;

  const options: { value: Choice; label: string; detail: string }[] = [
    { value: 'session', label: 'Just this workout', detail: 'The program stays as it is' },
    ...(summary.counts.block > 0 ? [{ value: 'block' as const, label: 'Same block', detail: others(summary.counts.block) }] : []),
    ...(summary.counts.program > summary.counts.block ? [{ value: 'program' as const, label: 'Whole program', detail: others(summary.counts.program) }] : [])
  ];
  const names = summary.edits.map(edit => edit.name);

  return <fieldset className="exercise-scope-options finish-plan-choice" disabled={disabled}>
    <legend>Update your program?</legend>
    <p>
      You changed the {summary.changes.join(', ')} for {names.length === 1 ? names[0] : `${names.length} exercises`}.
      Only what you changed is carried over; other days keep their own sets, rest and notes.
    </p>
    {options.map(option => <label className="checkbox-row exercise-scope-option" key={option.value}>
      <input type="radio" name="finish-plan-scope" value={option.value} checked={update.choice === option.value}
        onChange={() => update.setChoice(option.value)} />
      <span><strong>{option.label}</strong><small>{option.detail}</small></span>
    </label>)}
    {update.error && <p className="error-text" role="alert">{update.error}</p>}
  </fieldset>;
}
