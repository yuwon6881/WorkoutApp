/// Empty bounds mean the program sets no rep target (an AMRAP row, a blank cell).
type RepBounds = { repMin: number | null; repMax: number | null };

/// An exercise reads as a rep range as soon as any one of its sets has distinct bounds, so a
/// single "8–12" set is never silently collapsed by showing the exercise as exact reps.
export function usesRepRange(sets: RepBounds[]): boolean {
  return sets.some(set => set.repMin !== set.repMax);
}

/// The bounds a set takes when its exercise switches mode. Exact reps keep the lower bound;
/// opening a range from an exact target widens it by two, the smallest useful span.
export function withRepMode(set: RepBounds, range: boolean): RepBounds {
  if (set.repMin === null) return { repMin: null, repMax: null };
  if (!range) return { repMin: set.repMin, repMax: set.repMin };
  if (set.repMin !== set.repMax) return { repMin: set.repMin, repMax: set.repMax };
  return { repMin: set.repMin, repMax: set.repMin + 2 };
}
