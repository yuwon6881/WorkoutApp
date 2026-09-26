import type { Exercise } from '../types';

/// A program day, import-review day or editor draft exercise: only the catalog link, the written
/// name and which sets are warm-ups decide its credits.
export type PlannedExercise = { exerciseId: string | null; sourceName: string; name?: string; sets: { warmup: boolean }[] };
export type PlannedMuscleCredit = { muscle: string; sets: number };
export type PlannedMuscleSummary = {
  muscles: PlannedMuscleCredit[];
  unattributedExercises: number;
};

const MUSCLE_REGIONS = [
  'Neck', 'Traps', 'Shoulders', 'Chest', 'Back', 'Biceps', 'Triceps', 'Forearms',
  'Core', 'Glutes', 'Quads', 'Hamstrings', 'Adductors', 'Calves'
] as const;

const BUCKET_REGIONS: Record<string, string[]> = {
  'posterior chain': ['Hamstrings', 'Glutes'],
  'biceps and forearms': ['Biceps', 'Forearms'],
  'traps calves and hips': ['Traps', 'Calves', 'Glutes'],
  'adductors and neck': ['Adductors', 'Neck']
};

function normalize(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean).join(' ');
  return words.replace(/\b(pull|push|chin|sit|step|hang|warm) (ups?|downs?)\b/g, '$1$2');
}

function hasWord(name: string, word: string): boolean {
  return ` ${name} `.includes(` ${word} `);
}

function hasAny(name: string, ...phrases: string[]): boolean {
  return phrases.some(phrase => hasWord(name, phrase));
}

function add(credits: Map<string, number>, region: string, weight: number): void {
  credits.set(region, Math.max(credits.get(region) ?? 0, weight));
}

function primaryRefinement(bucket: string, name: string): string[] {
  if (bucket === 'posterior chain') {
    if (hasAny(name, 'leg curl', 'hamstring', 'nordic', 'glute ham')) return ['Hamstrings'];
    if (hasAny(name, 'hip thrust')) return ['Glutes'];
    if (hasAny(name, 'deadlift', 'rdl', 'good morning', 'hyperextension', 'pull through')) {
      return ['Hamstrings', 'Glutes'];
    }
  }

  if (bucket === 'biceps and forearms') {
    if (hasAny(name, 'wrist', 'pinch', 'hold', 'farmer')) return ['Forearms'];
    if (hasAny(name, 'hammer', 'zottman')) return ['Biceps', 'Forearms'];
    if (hasWord(name, 'curl')) return ['Biceps'];
  }

  if (bucket === 'traps calves and hips') {
    if (hasAny(name, 'calf', 'toe press')) return ['Calves'];
    if (hasAny(name, 'abduction', 'band walk')) return ['Glutes'];
    if (hasWord(name, 'shrug')) return ['Traps'];
  }

  if (bucket === 'adductors and neck') {
    if (hasWord(name, 'adduction')) return ['Adductors'];
    if (hasWord(name, 'neck')) return ['Neck'];
  }

  return [];
}

function refinedPrimary(name: string): string[] {
  for (const bucket of ['posterior chain', 'adductors and neck', 'traps calves and hips', 'biceps and forearms']) {
    const refined = primaryRefinement(bucket, name);
    if (refined.length > 0) return refined;
  }
  return [];
}

function movementSecondaries(name: string): string[] {
  if (!name) return [];
  const regions = new Set<string>();
  const calfPress = hasAny(name, 'calf raise', 'calf press', 'toe press');

  if (hasAny(name, 'squat', 'lunge') || (hasAny(name, 'leg press') && !calfPress)) regions.add('Glutes');
  if (hasAny(name, 'deadlift', 'rdl', 'good morning', 'hyperextension', 'pull through')) regions.add('Back');

  if (hasAny(name, 'overhead press', 'military press', 'strict press', 'push press', 'arnold press')) {
    regions.add('Triceps');
  } else if (hasAny(name, 'bench press', 'chest press', 'push up', 'pushup', 'shoulder press', 'incline press', 'decline press', 'floor press', 'landmine press')) {
    regions.add('Triceps');
    regions.add('Shoulders');
  }

  if (hasAny(name, 'row', 'pulldown', 'pull up', 'pullup')) regions.add('Biceps');
  return [...regions];
}

function exerciseCredits(name: string, exercise: Exercise | undefined): Map<string, number> {
  const normalizedName = normalize(name);
  const primary = normalize(exercise?.muscle ?? '');
  const credits = new Map<string, number>();
  const directRegion = MUSCLE_REGIONS.find(region => normalize(region) === primary);

  if (directRegion) {
    add(credits, directRegion, 1);
  } else if (BUCKET_REGIONS[primary]) {
    const refined = primaryRefinement(primary, normalizedName);
    if (refined.length > 0) {
      for (const region of refined) add(credits, region, 1);
    } else {
      const regions = [...new Set(BUCKET_REGIONS[primary])];
      for (const region of regions) add(credits, region, 1 / regions.length);
    }
  } else {
    for (const region of refinedPrimary(normalizedName)) add(credits, region, 1);
  }

  for (const secondary of exercise?.secondaryMuscles ?? []) {
    const region = MUSCLE_REGIONS.find(candidate => normalize(candidate) === normalize(secondary));
    if (region) add(credits, region, 0.5);
  }
  for (const region of movementSecondaries(normalizedName)) add(credits, region, 0.5);

  return credits;
}

function plannedSetCount(sets: PlannedExercise['sets']): number {
  return sets.filter(set => !set.warmup).length;
}

/** Mirrors the server's muscle attribution so planned day previews use the same region weights. */
export function getPlannedMuscleCredits(
  items: PlannedExercise[],
  catalog: Exercise[]
): PlannedMuscleSummary {
  const catalogById = new Map(catalog.map(exercise => [exercise.id, exercise]));
  const totals = new Map<string, number>();
  let unattributedExercises = 0;

  for (const item of items) {
    const setCount = plannedSetCount(item.sets);
    if (setCount === 0) continue;

    const exercise = item.exerciseId ? catalogById.get(item.exerciseId) : undefined;
    const credits = exerciseCredits(item.name || item.sourceName, exercise);
    if (credits.size === 0) {
      unattributedExercises++;
      continue;
    }

    for (const [muscle, weight] of credits) {
      totals.set(muscle, (totals.get(muscle) ?? 0) + weight * setCount);
    }
  }

  const muscles = [...totals]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((left, right) => right.sets - left.sets || left.muscle.localeCompare(right.muscle));

  return { muscles, unattributedExercises };
}
