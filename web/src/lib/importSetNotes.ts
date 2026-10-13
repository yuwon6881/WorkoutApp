import type { DraftSet } from '../types';
import { cleanTechniqueNotes, hasOpenReps, partialTechniqueLabel } from './importSetTypes';

// Printed reps the two rep inputs cannot hold: "7/7/7", "10+5", "6x8", "8, 6, 4".
const COMPOUND_REPS = /\d\s*[/+×x,]\s*\d/i;

/// What the source said about one set beyond its type and reps, so a review shows the myo-rep
/// protocol, a partial's range, or the segments of a 21s set instead of hiding them in the draft.
/// The set's own row stays one fixed shape; this text is listed beneath the grid.
export function setNoteText(set: DraftSet): string | null {
  const parts: string[] = [];
  const load = set.loadText?.trim();
  if (load) parts.push(`Load: ${load}`);
  const technique = partialTechniqueLabel(set);
  if (technique) parts.push(technique);
  const remainder = cleanTechniqueNotes(set.notes);
  if (remainder) parts.push(remainder);
  const printed = set.repsText?.trim();
  if (printed && !hasOpenReps(set) && COMPOUND_REPS.test(printed)) parts.push(`printed as ${printed}`);
  return parts.length ? parts.join(' · ') : null;
}

/// Adjacent identical instructions read once, while each set keeps its source prescription.
export function setNoteItems(sets: DraftSet[]): { label: string; text: string }[] {
  const groups: { warmup: boolean; first: number; last: number; text: string }[] = [];
  let warmups = 0;
  let working = 0;
  let previousHadNote = false;
  for (const set of sets) {
    const number = set.warmup ? ++warmups : ++working;
    const text = setNoteText(set);
    const previous = groups.at(-1);
    if (text && previousHadNote && previous?.text === text && previous.warmup === set.warmup) {
      previous.last = number;
    } else if (text) {
      groups.push({ warmup: set.warmup, first: number, last: number, text });
    }
    previousHadNote = Boolean(text);
  }
  return groups.map(group => ({
    label: group.first === group.last
      ? `${group.warmup ? 'Warm-up' : 'Set'} ${group.first}`
      : `${group.warmup ? 'Warm-ups' : 'Sets'} ${group.first}–${group.last}`,
    text: group.text
  }));
}
