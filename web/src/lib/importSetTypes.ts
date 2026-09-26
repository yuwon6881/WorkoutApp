import type { DraftSet } from '../types';

export type SetType = 'normal' | 'warmup' | 'dropset' | 'amrap' | 'myoreps' | 'partials' | 'lengthenedPartials' | 'integratedPartials';

export const setTypeOptions = [
  { value: 'normal', label: 'Normal set' },
  { value: 'warmup', label: 'Warm-up' },
  { value: 'dropset', label: 'Drop set' },
  { value: 'amrap', label: 'Failure / AMRAP' },
  { value: 'myoreps', label: 'Myo-reps' },
  { value: 'partials', label: 'Partial reps' },
  { value: 'lengthenedPartials', label: 'Lengthened partials' },
  { value: 'integratedPartials', label: 'Integrated partials' }
];

const PARTIAL_TECHNIQUE_LABELS: Partial<Record<SetType, string>> = {
  partials: 'Partial reps',
  lengthenedPartials: 'Lengthened partials',
  integratedPartials: 'Integrated partials'
};

export function getSetType(set: DraftSet): SetType {
  if (set.warmup) return 'warmup';
  const notes = (set.notes ?? '').toLowerCase();
  if (notes.includes('dropset') || notes.includes('drop set')) return 'dropset';
  if (notes.includes('amrap') || notes.includes('failure')) return 'amrap';
  if (notes.includes('myo-rep') || notes.includes('myorep')) return 'myoreps';
  if (/\b(?:lengthened|long[- ]length)\s+partials?\b/.test(notes)) return 'lengthenedPartials';
  if (/\bintegrated\s+partials?\b/.test(notes)) return 'integratedPartials';
  if (/\b(?:partials?(?:\s+reps?)?|half[- ]?rom|half\s+reps?)\b/.test(notes)) return 'partials';
  return 'normal';
}

export function partialTechniqueLabel(set: DraftSet): string | null {
  const label = PARTIAL_TECHNIQUE_LABELS[getSetType(set)];
  if (!label) return null;
  const notes = set.notes ?? '';
  const technique = /(?:lengthened|long[- ]length|integrated)?\s*partials?(?:\s+reps?)?|half[- ]?rom|half\s+reps?/i.exec(notes);
  const qualifier = technique && notes.slice(technique.index + technique[0].length).match(/^\s*(\([^)]{1,120}\))/)?.[1];
  return qualifier ? `${label} ${qualifier}` : label;
}

/// An AMRAP set the source printed without a rep count ("AMRAP", "Max reps"). Its stored rep
/// bounds are only a placeholder, so the review shows no rep target for it.
export function hasOpenReps(set: DraftSet): boolean {
  return getSetType(set) === 'amrap' && !!set.repsText?.trim() && !/\d/.test(set.repsText);
}

export function cleanTechniqueNotes(notes: string | null): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/(?:^|\s*—\s*|\s*,\s*)(?:Dropset|Drop set|To failure \/ AMRAP|AMRAP|Failure|Myo-reps|Myoreps|(?:(?:lengthened|long[- ]length|integrated)\s+)?partials?(?:\s+reps?)?|half[- ]?rom|half\s+reps?)(?:\s*\([^)]{0,120}\))?(?:\s*—\s*|\s*,\s*|$)/gi, '')
    .trim();
  return cleaned || null;
}

export function addTechniqueNote(notes: string | null, technique: string): string {
  const base = cleanTechniqueNotes(notes);
  return base ? `${base} — ${technique}` : technique;
}

export function applySetType(set: DraftSet, newType: SetType): Partial<DraftSet> {
  switch (newType) {
    case 'warmup':
      return {
        warmup: true,
        targetRpe: null,
        rir: null,
        rpeSource: 'userEdited',
        notes: cleanTechniqueNotes(set.notes)
      };
    case 'dropset':
      return {
        warmup: false,
        notes: addTechniqueNote(set.notes, 'Dropset'),
        rpeSource: 'userEdited'
      };
    case 'amrap':
      return {
        warmup: false,
        targetRpe: 10,
        rir: '0',
        notes: addTechniqueNote(set.notes, 'To failure / AMRAP'),
        rpeSource: 'userEdited'
      };
    case 'myoreps':
      return {
        warmup: false,
        notes: addTechniqueNote(set.notes, 'Myo-reps'),
        rpeSource: 'userEdited'
      };
    case 'partials':
    case 'lengthenedPartials':
    case 'integratedPartials':
      return {
        warmup: false,
        notes: addTechniqueNote(set.notes, PARTIAL_TECHNIQUE_LABELS[newType]!),
        rpeSource: 'userEdited'
      };
    case 'normal':
    default:
      return {
        warmup: false,
        // Leaving AMRAP asks for a rep target, so a printed "AMRAP" stops standing in for one.
        ...(hasOpenReps(set) ? { repsText: null } : {}),
        targetRpe: set.targetRpe ?? 8,
        notes: cleanTechniqueNotes(set.notes),
        rpeSource: 'userEdited'
      };
  }
}
