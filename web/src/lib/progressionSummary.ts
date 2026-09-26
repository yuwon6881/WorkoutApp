import type { Session, SessionExercise } from '../types';

export type ProgressionSummary = {
  mode: 'normal' | 'conservative' | 'preservation';
  goal: string | null;
  label: string;
  reason: string;
  nutritionStatus: 'fresh' | 'cached' | 'stale' | 'unconfirmed' | 'absent';
};

const CACHE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
type ProgressionMode = ProgressionSummary['mode'];

function knownMode(value: string | null | undefined): ProgressionMode | null {
  return value === 'normal' || value === 'conservative' || value === 'preservation' ? value : null;
}

function storedMode(exercise: SessionExercise): ProgressionMode | null {
  const exerciseMode = exercise.progression?.mode ?? exercise.progression?.progressionMode;
  const modes = [
    knownMode(exerciseMode),
    ...exercise.sets.map(set => knownMode(set.suggestion?.progressionMode))
  ].filter((mode): mode is ProgressionMode => mode !== null);
  if (modes.includes('preservation')) return 'preservation';
  if (modes.includes('conservative')) return 'conservative';
  return modes[0] ?? null;
}

function storedReason(session: Session, mode: ProgressionMode): string | null {
  for (const exercise of session.exercises) {
    if (knownMode(exercise.progression?.mode ?? exercise.progression?.progressionMode) === mode && exercise.progression?.reason) {
      return exercise.progression.reason;
    }
    const setReason = exercise.sets.find(set => knownMode(set.suggestion?.progressionMode) === mode && set.suggestion?.reason)?.suggestion?.reason;
    if (setReason) return setReason;
  }
  return null;
}

function nutritionFreshAtWorkoutStart(session: Session): boolean {
  const context = session.nutritionContext;
  if (!context?.confirmed || !context.retrievedAt) return false;
  const retrievedAt = Date.parse(context.retrievedAt);
  const startedAt = Date.parse(session.startedAt);
  const age = startedAt - retrievedAt;
  return Number.isFinite(age) && age >= 0 && age <= CACHE_WINDOW_MS;
}

function nutritionMode(session: Session): ProgressionMode {
  const context = session.nutritionContext;
  if (!context?.confirmed || context.phaseComplete || context.effectiveGoal !== 'lose') return 'normal';

  const observed = context.observedWindowDays != null && context.observedWindowDays >= 14
    ? context.observedLossRatePercent
    : null;
  const rates = [context.targetRatePercent, observed]
    .filter((rate): rate is number => rate != null && Number.isFinite(rate) && rate >= 0)
    .map(Math.abs);
  if (rates.length === 0) return 'normal';
  return Math.max(...rates) >= 0.75 ? 'preservation' : 'conservative';
}

function nutritionStatus(session: Session, isFresh: boolean): ProgressionSummary['nutritionStatus'] {
  const context = session.nutritionContext;
  if (!context) return 'absent';
  if (!isFresh) return context.confirmed || context.cached ? 'stale' : 'unconfirmed';
  return context.cached ? 'cached' : 'fresh';
}

function displayGoal(goal: string | null | undefined): string | null {
  if (!goal) return null;
  const normalized = goal.toLowerCase();
  if (normalized === 'gain') return 'Gain';
  if (normalized === 'lose') return 'Loss';
  if (normalized === 'maintain') return 'Maintenance';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function makeReason(
  mode: ProgressionMode,
  goal: string | null,
  status: ProgressionSummary['nutritionStatus'],
  rates: number[],
  phaseComplete: boolean,
  appliedReason: string | null,
  hasStoredMode: boolean
): string {
  const stored = hasStoredMode
    ? `${appliedReason ? `${appliedReason} ` : ''}Stored workout suggestions use ${mode} progression.`
    : '';
  if (status === 'stale' || status === 'unconfirmed') {
    if (hasStoredMode)
      return `${stored} Nutrition data was stale or unconfirmed at workout start; the stored session decision is retained.`;
    return status === 'stale'
      ? 'The frozen Nutrition snapshot was not confirmed and fresh at workout start; standard progression applied.'
      : 'Nutrition did not confirm a usable context at workout start; standard progression applied.';
  }
  if (status === 'absent') {
    return hasStoredMode
      ? stored
      : 'Standard progression follows the recorded reps and effort.';
  }

  const source = status === 'cached' ? 'The saved Nutrition snapshot' : 'Nutrition';
  let contextReason: string;
  if (goal === 'Gain') {
    contextReason = `${source} reports a gain goal. The goal alone does not verify a calorie surplus.`;
  } else if (goal === 'Maintenance') {
    contextReason = `${source} reports a maintenance goal.`;
  } else if (goal === 'Loss' && phaseComplete) {
    contextReason = `${source} reports a completed loss phase.`;
  } else if (goal === 'Loss' && rates.length === 0) {
    contextReason = `${source} reports a loss goal, but no qualifying recorded loss-rate evidence was available.`;
  } else if (goal === 'Loss' && mode === 'preservation') {
    contextReason = `${source} reports a loss goal and a recorded rate of ${Math.max(...rates).toFixed(2)}% per week; this selects preservation progression.`;
  } else if (goal === 'Loss' && mode === 'conservative') {
    contextReason = `${source} reports a loss goal and a recorded rate below 0.75% per week; this selects conservative progression, which requires 2 qualifying exposures before load advances.`;
  } else if (goal === 'Loss') {
    contextReason = `${source} reports a loss goal without a recorded rate that selects an adaptive tier; normal progression applies.`;
  } else {
    contextReason = `${source} has no recognized training goal; ${mode} progression follows recorded reps and effort.`;
  }
  return hasStoredMode ? `${contextReason} ${stored}` : `${contextReason} ${mode} progression follows recorded reps and effort.`;
}

export function getProgressionSummary(session: Session): ProgressionSummary | null {
  const nutrition = session.nutritionContext;
  const hasStoredMode = session.exercises.some(exercise => storedMode(exercise) !== null);
  const isFresh = nutritionFreshAtWorkoutStart(session);
  const status = nutritionStatus(session, isFresh);

  // Stored suggestions are the session's historical decision. Only use the frozen context as a
  // fallback when no suggestion was saved, and never make a stale context look active.
  const storedModes = session.exercises.map(storedMode).filter((mode): mode is ProgressionMode => mode !== null);
  const mode = storedModes.includes('preservation')
    ? 'preservation'
    : storedModes.includes('conservative')
      ? 'conservative'
      : storedModes[0] ?? (isFresh ? nutritionMode(session) : 'normal');

  if (!hasStoredMode && !nutrition) return null;
  const goal = isFresh ? displayGoal(nutrition?.effectiveGoal) : null;
  const rates = nutrition && isFresh
    ? [
        nutrition.targetRatePercent,
        nutrition.observedWindowDays != null && nutrition.observedWindowDays >= 14
          ? nutrition.observedLossRatePercent
          : null
      ].filter((rate): rate is number => rate != null && Number.isFinite(rate) && rate >= 0).map(Math.abs)
    : [];
  const modeName = mode === 'preservation'
    ? 'Preservation progression'
    : mode === 'conservative'
      ? 'Conservative progression'
      : 'Normal progression';
  const appliedReason = hasStoredMode ? storedReason(session, mode) : null;

  return {
    mode,
    goal,
    label: goal ? `${goal} goal · ${modeName}` : modeName,
    reason: makeReason(mode, goal, status, rates, nutrition?.phaseComplete ?? false, appliedReason, hasStoredMode),
    nutritionStatus: status
  };
}
