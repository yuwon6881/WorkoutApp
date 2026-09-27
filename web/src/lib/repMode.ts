/// Empty bounds mean the program sets no rep target (an AMRAP row, a blank cell).
type RepBounds = { repMin: number | null; repMax: number | null };

/// An exercise reads as a rep range as soon as any one of its sets has distinct bounds, so a
/// single "8–12" set is never silently collapsed by showing the exercise as exact reps.
export function usesRepRange(sets: RepBounds[]): boolean {
  return sets.some(set => set.repMin !== set.repMax);
}

/// Changes the exercise-wide mode while remembering each set's range width. Exact mode stores
/// equal bounds, so the width has to live with the editor while a user switches back and forth.
export function toggleRepMode<T extends RepBounds>(
  sets: T[],
  range: boolean,
  rememberedWidths: Map<number, number>
): T[] {
  if (!range) {
    if (usesRepRange(sets)) {
      sets.forEach((set, index) => {
        if (set.repMin !== null && set.repMax !== null) {
          rememberedWidths.set(index, Math.max(0, set.repMax - set.repMin));
        }
      });
    }

    return sets.map(set => ({ ...set, ...withRepMode(set, false) }));
  }

  return sets.map((set, index) => ({
    ...set,
    ...withRepMode(set, true, rememberedWidths.get(index))
  }));
}

/// The bounds a set takes when its exercise switches mode. Exact reps keep the lower bound;
/// opening a range from an exact target widens it by two unless the editor remembers its old width.
export function withRepMode(set: RepBounds, range: boolean, rememberedWidth?: number): RepBounds {
  if (set.repMin === null) return { repMin: null, repMax: null };
  if (!range) return { repMin: set.repMin, repMax: set.repMin };
  if (rememberedWidth !== undefined) {
    return { repMin: set.repMin, repMax: set.repMin + rememberedWidth };
  }
  if (set.repMin !== set.repMax) return { repMin: set.repMin, repMax: set.repMax };
  return { repMin: set.repMin, repMax: set.repMin + 2 };
}
