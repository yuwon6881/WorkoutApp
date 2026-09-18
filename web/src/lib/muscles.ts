import type { Exercise } from '../types';

type ExerciseLike = {
  exerciseId?: string | null;
  name?: string | null;
  sourceName?: string | null;
};

const COMPOUND_MUSCLE_MAP: Record<string, string[]> = {
  'adductors and neck': ['Adductors', 'Neck'],
  'biceps and forearms': ['Biceps', 'Forearms'],
  'traps, calves, and hips': ['Traps', 'Calves'],
  'posterior chain': ['Hamstrings', 'Glutes'],
  'quads': ['Quads'],
  'chest': ['Chest'],
  'back': ['Back'],
  'core': ['Core'],
  'shoulders': ['Shoulders'],
  'triceps': ['Triceps']
};

const HEURISTIC_KEYWORDS: [RegExp, string][] = [
  [/\b(quad|squat|leg extension|lunge|hack|split squat|leg press)\b/i, 'Quads'],
  [/\b(hamstring|leg curl|rdl|romanian deadlift|good morning|stiff-leg)\b/i, 'Hamstrings'],
  [/\b(glute|hip thrust|abduction|kickback)\b/i, 'Glutes'],
  [/\b(bench|chest|pec|flye?|incline press|push-?up)\b/i, 'Chest'],
  [/\b(shoulder|overhead press|lateral raise|delts?|y-raise|military press|arnold press)\b/i, 'Shoulders'],
  [/\b(row|pull-?up|pull-?down|lats?|chin-?up|deadlift)\b/i, 'Back'],
  [/\b(biceps?|curl|preacher)\b/i, 'Biceps'],
  [/\b(triceps?|pressdown|pushdown|skull crusher|dip)\b/i, 'Triceps'],
  [/\b(calves?|calf)\b/i, 'Calves'],
  [/\b(traps?|shrug|kelso)\b/i, 'Traps'],
  [/\b(abs?|core|dragon flag|plank|crunch)\b/i, 'Core']
];

function normalizeCatalogMuscle(muscle: string): string[] {
  const clean = muscle.trim().toLowerCase();
  if (COMPOUND_MUSCLE_MAP[clean]) return COMPOUND_MUSCLE_MAP[clean];
  if (!muscle.trim()) return [];
  return [muscle.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')];
}

function inferMusclesFromName(name: string): string[] {
  const matches = new Set<string>();
  for (const [regex, muscle] of HEURISTIC_KEYWORDS) {
    if (regex.test(name)) {
      matches.add(muscle);
    }
  }
  return [...matches];
}

export function getWorkoutMuscles(items: ExerciseLike[], catalog: Exercise[]): string[] {
  const catalogById = new Map<string, Exercise>();
  const catalogByName = new Map<string, Exercise>();

  for (const ex of catalog) {
    catalogById.set(ex.id, ex);
    catalogByName.set(ex.name.toLowerCase().trim(), ex);
    for (const alias of ex.aliases) {
      catalogByName.set(alias.toLowerCase().trim(), ex);
    }
  }

  const result = new Set<string>();

  for (const item of items) {
    let matched: Exercise | undefined;
    if (item.exerciseId) {
      matched = catalogById.get(item.exerciseId);
    }

    const name = (item.name || item.sourceName || '').trim();
    if (!matched && name) {
      matched = catalogByName.get(name.toLowerCase());
    }

    if (matched?.muscle) {
      for (const m of normalizeCatalogMuscle(matched.muscle)) {
        result.add(m);
      }
    } else if (name) {
      for (const m of inferMusclesFromName(name)) {
        result.add(m);
      }
    }
  }

  return [...result].sort((a, b) => a.localeCompare(b));
}
