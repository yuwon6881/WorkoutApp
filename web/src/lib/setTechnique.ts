import type { LoggedSet, SessionExercise, SetPrescription } from '../types';

/// Mirrors the server's SetTechniques: a prescribed intensity technique, read from the set notes
/// the builder and import write. Partials shorten the range and myo-reps and drop sets add reps
/// after little or no rest, so these sets are real work but not straight-set strength. They never
/// announce a record or count against one. Failure/AMRAP stays a straight set.
export type SetTechnique = 'dropset' | 'myoreps' | 'lengthenedPartials' | 'integratedPartials' | 'partials';

const PATTERNS: Array<[SetTechnique, RegExp]> = [
  ['dropset', /\bdrop\s?sets?\b/i],
  ['myoreps', /\bmyo[- ]?reps?\b/i],
  ['lengthenedPartials', /\b(?:lengthened|long[- ]length)\s+partials?\b/i],
  ['integratedPartials', /\bintegrated\s+partials?\b/i],
  ['partials', /\bpartials?\b|\bhalf[- ]?rom\b|\bhalf\s+reps?\b/i]
];

export function setTechnique(prescription: Pick<SetPrescription, 'notes' | 'warmup'> | null | undefined): SetTechnique | null {
  if (!prescription || prescription.warmup || !prescription.notes) return null;
  return PATTERNS.find(([, pattern]) => pattern.test(prescription.notes!))?.[0] ?? null;
}

/// Whether a logged set may count as straight-set strength: a warm-up never does, and neither
/// does a set its prescription gave a technique.
export function isStrengthSet(exercise: Pick<SessionExercise, 'prescription'>, set: Pick<LoggedSet, 'position' | 'warmup'>): boolean {
  return !set.warmup && setTechnique(exercise.prescription[set.position]) === null;
}
