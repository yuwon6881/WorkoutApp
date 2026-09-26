import type { LoggedSet, SessionExercise, SetPrescription } from '../types';
import { getSupersetGroup } from './supersets';

export type WorkoutStep = {
  exercise: SessionExercise;
  setIndex: number;
  set?: LoggedSet | null;
  prescription?: SetPrescription | null;
};

export function getSupersetOrder(sequenceGroup?: string | null, position?: number): number {
  if (sequenceGroup) {
    const match = sequenceGroup.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }
  return (position ?? 0) + 1;
}

export function restAppliesAfter(
  currentStep: WorkoutStep,
  nextStep: WorkoutStep | null | undefined
): boolean {
  const currentWarmup = Boolean(currentStep.set?.warmup ?? currentStep.prescription?.warmup);
  const nextWarmup = Boolean(nextStep?.set?.warmup ?? nextStep?.prescription?.warmup);
  // Only the final warm-up before working sets needs recovery. Working sets, including
  // myo-reps and the final set, always rest except for the immediate superset handoff.
  if (currentWarmup) return Boolean(nextStep) && !nextWarmup;
  if (!nextStep) return true;

  // Superset transition check:
  // If both exercises share a non-empty superset group and are different exercises:
  const currentGroup = getSupersetGroup(currentStep.exercise.sequenceGroup);
  const nextGroup = getSupersetGroup(nextStep.exercise.sequenceGroup);
  if (currentGroup && nextGroup && currentGroup === nextGroup && currentStep.exercise.id !== nextStep.exercise.id) {
    const currentOrder = getSupersetOrder(currentStep.exercise.sequenceGroup, currentStep.exercise.position);
    const nextOrder = getSupersetOrder(nextStep.exercise.sequenceGroup, nextStep.exercise.position);
    if (currentOrder < nextOrder) {
      return false;
    }
  }

  return true;
}

export function findNextStep(exercises: SessionExercise[], currentEi: number, currentSi: number): WorkoutStep | null {
  const currentEx = exercises[currentEi];
  if (!currentEx) return null;

  // If in a superset, look for the next partner in the same superset group
  const group = getSupersetGroup(currentEx.sequenceGroup);
  if (group) {
    const partners = exercises.filter(e => getSupersetGroup(e.sequenceGroup) === group);
    const sortedPartners = [...partners].sort((a, b) =>
      getSupersetOrder(a.sequenceGroup, a.position) - getSupersetOrder(b.sequenceGroup, b.position)
    );
    const partnerIndex = sortedPartners.findIndex(e => e.id === currentEx.id);
    if (partnerIndex >= 0 && partnerIndex < sortedPartners.length - 1) {
      // Next partner in round
      const nextPartner = sortedPartners[partnerIndex + 1];
      const targetSi = nextPartner.sets[currentSi] && !nextPartner.sets[currentSi].done
        ? currentSi
        : nextPartner.sets.findIndex(s => !s.done);
      if (targetSi >= 0) {
        return {
          exercise: nextPartner,
          setIndex: targetSi,
          set: nextPartner.sets[targetSi],
          prescription: nextPartner.prescription[targetSi]
        };
      }
    } else if (partnerIndex === sortedPartners.length - 1) {
      // Last partner in round: next step is first partner for next set index
      const firstPartner = sortedPartners[0];
      const nextSi = currentSi + 1;
      const targetSi = firstPartner.sets[nextSi] && !firstPartner.sets[nextSi].done
        ? nextSi
        : firstPartner.sets.findIndex((set, index) => !set.done && (firstPartner.id !== currentEx.id || index !== currentSi));
      if (targetSi >= 0) {
        return {
          exercise: firstPartner,
          setIndex: targetSi,
          set: firstPartner.sets[targetSi],
          prescription: firstPartner.prescription[targetSi]
        };
      }
    }
  }

  // Straight sets or fallback: next uncompleted set in current exercise
  for (let si = currentSi + 1; si < currentEx.sets.length; si++) {
    if (!currentEx.sets[si].done) {
      return {
        exercise: currentEx,
        setIndex: si,
        set: currentEx.sets[si],
        prescription: currentEx.prescription[si]
      };
    }
  }

  // Next exercises with uncompleted sets
  for (let ei = currentEi + 1; ei < exercises.length; ei++) {
    const nextEx = exercises[ei];
    const firstUncompleted = nextEx.sets.findIndex(s => !s.done);
    if (firstUncompleted >= 0) {
      return {
        exercise: nextEx,
        setIndex: firstUncompleted,
        set: nextEx.sets[firstUncompleted],
        prescription: nextEx.prescription[firstUncompleted]
      };
    }
  }

  return null;
}
