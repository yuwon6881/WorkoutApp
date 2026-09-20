import { Info } from 'lucide-react';
import type { DraftSet } from '../types';
import { validateText } from '../lib/validation';
import { Field } from './ui/Field';

export function ImportSetSourceFields({ exerciseLineId, exerciseName, index, setNumber, set, onChange }: {
  exerciseLineId: string;
  exerciseName: string;
  index: number;
  setNumber: number;
  set: DraftSet;
  onChange: (patch: Partial<DraftSet>) => void;
}) {
  const setLabel = `${set.warmup ? 'warm-up' : 'set'} ${setNumber}`;
  const repsLabel = `Source reps (verbatim) for ${exerciseName} ${setLabel}`;
  const loadLabel = `Source load for ${exerciseName} ${setLabel}`;

  return <>
    <Field name={`source-reps-${exerciseLineId}-${index}`}
      label={<>Source reps (verbatim){set.repsText && <span className={`provenance ${set.repsSource}`} aria-hidden="true">{provenanceLabel(set.repsSource)}</span>}</>}
      aria-label={repsLabel} placeholder="e.g. 10/10 or AMRAP" value={set.repsText ?? ''} maxLength={40}
      error={validateText(set.repsText, 'Verbatim reps', 40)}
      data-import-field="repsText" data-import-set-index={index}
      onChange={event => onChange({ repsText: event.target.value || null, repsSource: 'userEdited' })} />
    <Field name={`source-load-${exerciseLineId}-${index}`} label="Source load" aria-label={loadLabel}
      placeholder="e.g. 70% 1RM" value={set.loadText ?? ''} maxLength={60}
      error={validateText(set.loadText, 'Load', 60)} data-import-field="loadText" data-import-set-index={index}
      onChange={event => onChange({ loadText: event.target.value || null })} />
    {hasPercentageLoad(set.loadText) && set.targetRpe == null && <div className="notice-list import-set-source-load-notice" role="note" style={{ gridColumn: '1 / -1' }}>
      <p><Info size={14} aria-hidden="true" />The PDF lists {set.loadText} as a load target but does not specify RPE. This source information does not set an RPE.</p>
    </div>}
  </>;
}

function hasPercentageLoad(loadText: string | null): boolean {
  return loadText != null && /^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*(?:1\s*RM)?$/i.test(loadText.trim());
}

function provenanceLabel(source: DraftSet['repsSource']): string {
  switch (source) {
    case 'extracted': return 'Extracted';
    case 'inferred': return 'Bounds inferred';
    case 'userEdited': return 'Edited';
  }
}
