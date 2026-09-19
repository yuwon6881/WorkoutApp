import type { DraftSet } from '../types';

export type SetType = 'normal' | 'warmup' | 'dropset' | 'amrap' | 'myoreps';

export const setTypeOptions = [
  { value: 'normal', label: 'Normal set' },
  { value: 'warmup', label: 'Warm-up' },
  { value: 'dropset', label: 'Drop set' },
  { value: 'amrap', label: 'Failure / AMRAP' },
  { value: 'myoreps', label: 'Myo-reps' }
];

export function getSetType(set: DraftSet): SetType {
  if (set.warmup) return 'warmup';
  const notes = (set.notes ?? '').toLowerCase();
  if (notes.includes('dropset') || notes.includes('drop set')) return 'dropset';
  if (notes.includes('amrap') || notes.includes('failure')) return 'amrap';
  if (notes.includes('myo-rep') || notes.includes('myorep')) return 'myoreps';
  return 'normal';
}

export function getSetTypeLabel(set: DraftSet): string {
  const type = getSetType(set);
  switch (type) {
    case 'warmup': return 'Warm-up';
    case 'dropset': return 'Drop set';
    case 'amrap': return 'AMRAP';
    case 'myoreps': return 'Myo-reps';
    default: return 'Set';
  }
}

export function cleanTechniqueNotes(notes: string | null): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/(?:^|\s*—\s*|\s*,\s*)(?:Dropset|Drop set|To failure \/ AMRAP|AMRAP|Failure|Myo-reps|Myoreps)(?:\s*—\s*|\s*,\s*|$)/gi, '')
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
        notes: addTechniqueNote(set.notes, 'To failure / AMRAP'),
        rpeSource: 'userEdited'
      };
    case 'myoreps':
      return {
        warmup: false,
        notes: addTechniqueNote(set.notes, 'Myo-reps'),
        rpeSource: 'userEdited'
      };
    case 'normal':
    default:
      return {
        warmup: false,
        targetRpe: set.targetRpe ?? 8,
        notes: cleanTechniqueNotes(set.notes),
        rpeSource: 'userEdited'
      };
  }
}
