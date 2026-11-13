import type { Exercise } from '../types';
import { MUSCLE_SIDE } from './muscleFocus';

/// The catalog files some movements under a group of muscles ("Biceps and forearms"). A thumbnail can
/// frame only one plate, so the movement's own name picks the member it trains.
const GROUP_MEMBERS: Record<string, { fallback: string; byName: [RegExp, string][] }> = {
  'Posterior chain': { fallback: 'Hamstrings', byName: [[/hip thrust|glute|bridge|kickback|pull-through/i, 'Glutes'], [/back extension|good morning|hyper/i, 'Back']] },
  'Biceps and forearms': { fallback: 'Biceps', byName: [[/wrist|forearm|grip|reverse curl/i, 'Forearms']] },
  'Traps, calves, and hips': { fallback: 'Traps', byName: [[/calf|toe press|tibia/i, 'Calves'], [/hip|abduct/i, 'Abductors']] },
  'Adductors and neck': { fallback: 'Adductors', byName: [[/neck/i, 'Neck']] }
};

const isPlate = (muscle: string | undefined): muscle is string => Boolean(muscle && MUSCLE_SIDE[muscle]);

/** The body-map plate that illustrates an exercise, or null when no single plate does (full body). */
export function muscleThumbTarget(exercise: Pick<Exercise, 'name' | 'muscle' | 'secondaryMuscles'>): string | null {
  if (isPlate(exercise.muscle)) return exercise.muscle;
  const group = GROUP_MEMBERS[exercise.muscle];
  if (group) {
    const named = group.byName.find(([pattern]) => pattern.test(exercise.name));
    if (named) return named[1];
    return group.fallback;
  }
  return exercise.secondaryMuscles?.find(isPlate) ?? null;
}
