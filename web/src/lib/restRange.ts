import type { SessionExercise } from '../types';

export type RestMode = 'minimal' | 'balanced' | 'maximal';

export type RestRange = {
  minSeconds: number;
  maxSeconds: number;
  balancedSeconds: number;
};

const RANGE_REGEX = /(\d+(?:\.\d+)?)\s*(?:[-–]|to)\s*(\d+(?:\.\d+)?)/i;
const SEC_REGEX = /\b(?:sec|secs|second|seconds)\b|(?:\d|\))\s*s\b/i;
const MIN_REGEX = /\b(?:m|min|mins|minute|minutes)\b|(?:\d|\))\s*m\b/i;

/// Parses a printed rest range such as "2-3 min", "90-120 sec", "2 – 3 minutes", "60-90s".
/// Returns null unless the text states two DIFFERENT numbers with min < max.
export function parseRestRange(restText: string | null | undefined): RestRange | null {
  if (!restText) return null;
  const match = restText.match(RANGE_REGEX);
  if (!match) return null;

  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return null;
  }

  const average = (min + max) / 2;
  const lower = restText.toLowerCase();

  let multiplier = 1;
  if (SEC_REGEX.test(lower)) {
    multiplier = 1;
  } else if (lower.includes('hour') || lower.includes('hr')) {
    multiplier = 3600;
  } else if (MIN_REGEX.test(lower) || average <= 10) {
    multiplier = 60;
  } else {
    multiplier = 1;
  }

  const minSeconds = Math.round(min * multiplier);
  const maxSeconds = Math.round(max * multiplier);
  const balancedSeconds = Math.round(average * multiplier);

  if (
    !Number.isFinite(minSeconds) ||
    !Number.isFinite(maxSeconds) ||
    minSeconds >= maxSeconds ||
    maxSeconds > 3600
  ) {
    return null;
  }

  return { minSeconds, maxSeconds, balancedSeconds };
}

/// The range the plan gives the set at setIndex, falling back to the exercise's first working set.
/// Returns null when there is no usable range.
export function planRestRange(exercise: SessionExercise, setIndex: number): RestRange | null {
  const prescriptions = exercise.prescription ?? [];
  if (prescriptions.length === 0) return null;

  const currentSet = prescriptions[setIndex];
  let targetSet = currentSet;
  let parsed = parseRestRange(targetSet?.restText);

  if (!parsed) {
    const firstWorking = prescriptions.find(set => !set.warmup) ?? prescriptions[0];
    if (firstWorking && firstWorking !== targetSet) {
      targetSet = firstWorking;
      parsed = parseRestRange(targetSet.restText);
    }
  }

  if (!parsed || !targetSet) return null;

  if (targetSet.restSeconds != null && Math.abs(targetSet.restSeconds - parsed.balancedSeconds) > 1) {
    return null;
  }

  return parsed;
}

/// True when any exercise in the session has a usable range (drives whether the toggle is shown).
export function sessionHasRestRange(exercises: readonly SessionExercise[]): boolean {
  return exercises.some(exercise =>
    exercise.prescription.some((_, setIndex) => planRestRange(exercise, setIndex) !== null)
  );
}
