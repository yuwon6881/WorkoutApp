import type { DraftSet } from '../types';
import { cleanTechniqueNotes, hasOpenReps, partialTechniqueLabel } from './importSetTypes';

// Printed reps the two rep inputs cannot hold: "7/7/7", "10+5", "6x8", "8, 6, 4".
const COMPOUND_REPS = /\d\s*[/+×x,]\s*\d/i;

/// What the source said about one set beyond its type and reps, so a review shows the myo-rep
/// protocol, a partial's range, or the segments of a 21s set instead of hiding them in the draft.
/// The set's own row stays one fixed shape; this text is listed beneath the grid.
export function setNoteText(set: DraftSet): string | null {
  const parts: string[] = [];
  const technique = partialTechniqueLabel(set);
  if (technique) parts.push(technique);
  const remainder = cleanTechniqueNotes(set.notes);
  if (remainder) parts.push(remainder);
  const printed = set.repsText?.trim();
  if (printed && !hasOpenReps(set) && COMPOUND_REPS.test(printed)) parts.push(`printed as ${printed}`);
  return parts.length ? parts.join(' · ') : null;
}
