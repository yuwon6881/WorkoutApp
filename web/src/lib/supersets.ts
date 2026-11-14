export interface ExerciseWithGroup {
  id: string;
  sequenceGroup?: string | null;
}

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export function getSupersetGroup(sequenceGroup?: string | null): string {
  if (!sequenceGroup) return '';
  const match = sequenceGroup.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : '';
}

export function isSuperset(sequenceGroup?: string | null): boolean {
  return getSupersetGroup(sequenceGroup).length > 0;
}

export function getSupersetPartners<T extends ExerciseWithGroup>(
  currentId: string,
  exercises: T[]
): T[] {
  const current = exercises.find(e => e.id === currentId);
  if (!current) return [];
  const group = getSupersetGroup(current.sequenceGroup);
  if (!group) return [];
  return exercises.filter(e => e.id !== currentId && getSupersetGroup(e.sequenceGroup) === group);
}

export function pairExercises<T extends ExerciseWithGroup>(
  exercises: T[],
  idA: string,
  idB: string
): T[] {
  if (idA === idB) return exercises;
  const exA = exercises.find(e => e.id === idA);
  const exB = exercises.find(e => e.id === idB);
  if (!exA || !exB) return exercises;

  const groupA = getSupersetGroup(exA.sequenceGroup);
  const groupB = getSupersetGroup(exB.sequenceGroup);

  let targetGroup = groupA || groupB;
  if (!targetGroup) {
    const usedLetters = new Set(
      exercises.map(e => getSupersetGroup(e.sequenceGroup)).filter(Boolean)
    );
    targetGroup = GROUP_LETTERS.find(letter => !usedLetters.has(letter)) ?? 'A';
  }

  const pairedIds = new Set<string>([idA, idB]);
  for (const e of exercises) {
    if (getSupersetGroup(e.sequenceGroup) === targetGroup) {
      pairedIds.add(e.id);
    }
  }

  let index = 1;
  return exercises.map(e => {
    if (pairedIds.has(e.id)) {
      return {
        ...e,
        sequenceGroup: `${targetGroup}${index++}`
      };
    }
    return e;
  });
}

export function unlinkExercise<T extends ExerciseWithGroup>(
  exercises: T[],
  targetId: string
): T[] {
  const target = exercises.find(e => e.id === targetId);
  if (!target) return exercises;
  const group = getSupersetGroup(target.sequenceGroup);
  if (!group) return exercises;

  const updated = exercises.map(e => (e.id === targetId ? { ...e, sequenceGroup: '' } : e));

  const remainingInGroup = updated.filter(e => getSupersetGroup(e.sequenceGroup) === group);
  if (remainingInGroup.length <= 1) {
    return updated.map(e => (getSupersetGroup(e.sequenceGroup) === group ? { ...e, sequenceGroup: '' } : e));
  }

  let index = 1;
  return updated.map(e => {
    if (getSupersetGroup(e.sequenceGroup) === group) {
      return {
        ...e,
        sequenceGroup: `${group}${index++}`
      };
    }
    return e;
  });
}

export interface SupersetSlot {
  group: string;
  /** 1-based place within the group, in workout order. */
  position: number;
  size: number;
  /** Alternates between groups so two supersets side by side never share a colour. */
  tone: 0 | 1;
}

/// Where each paired exercise sits in its superset, for the markers that show which exercises belong
/// together. An exercise alone in its group is not paired, so it has no entry.
export function supersetLayout<T extends ExerciseWithGroup>(exercises: T[]): Map<string, SupersetSlot> {
  const members = new Map<string, string[]>();
  for (const exercise of exercises) {
    const group = getSupersetGroup(exercise.sequenceGroup);
    if (group) members.set(group, [...(members.get(group) ?? []), exercise.id]);
  }
  const layout = new Map<string, SupersetSlot>();
  let tone = 0;
  for (const [group, ids] of members) {
    if (ids.length < 2) continue;
    ids.forEach((id, index) => layout.set(id, { group, position: index + 1, size: ids.length, tone: (tone % 2) as 0 | 1 }));
    tone++;
  }
  return layout;
}
