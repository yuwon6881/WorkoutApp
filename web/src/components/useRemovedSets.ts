import { useEffect, useRef, useState } from 'react';
import type { Session, SessionExercise } from '../types';
import { withSetRestored, type RemovedSet } from '../lib/workoutDraft';
import { useReducedMotion } from './ui/Motion';

// Long enough to notice a mistaken swipe-delete and reach Undo, short enough not to linger.
const UNDO_WINDOW_MS = 5000;
// Matches the placeholder's collapse in WorkoutLogger.css.
const COLLAPSE_MS = 200;

/// A removed set held in its row's place for a moment, so nothing below it moves while Undo is offered.
export type RemovedPlaceholder = {
  key: string;
  removal: RemovedSet;
  /// As the row showed it ("2", "W1").
  label: string;
  /// The set the placeholder follows, or null when it leads the list. A set id rather than an
  /// index, so later removals and restores elsewhere in the list cannot move it.
  anchorId: string | null;
  /// The removed row's height, kept so the list does not shift.
  height: number;
  leaving: boolean;
};

/**
 * The placeholders shown where sets were removed, each with its own Undo for a few seconds before it
 * collapses. The removal itself is saved at once; Undo puts the same set back where it was.
 */
export function useRemovedSets(draft: Session, exerciseIndex: number, change: (next: Session) => void) {
  const [placeholders, setPlaceholders] = useState<RemovedPlaceholder[]>([]);
  const reduced = useReducedMotion();
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);

  function expire(key: string) {
    setPlaceholders(current => current.map(item => item.key === key ? { ...item, leaving: true } : item));
    timers.current.set(key, window.setTimeout(() => {
      timers.current.delete(key);
      setPlaceholders(current => current.filter(item => item.key !== key));
    }, reduced ? 0 : COLLAPSE_MS));
  }

  /** Holds a just-removed set's place. `exercise` is the list before the removal. */
  function hold(exercise: SessionExercise, removal: RemovedSet, label: string, height: number) {
    const key = removal.set.id;
    const anchorId = exercise.sets[removal.index - 1]?.id ?? null;
    setPlaceholders(current => {
      // Placeholders that followed the removed set now follow its own anchor, after it.
      const moved = current.map(item => item.anchorId === key ? { ...item, anchorId } : item);
      const at = moved.findIndex((item, i) => item.anchorId === anchorId && current[i].anchorId === key);
      const next = { key, removal, label, anchorId, height, leaving: false };
      return at < 0 ? [...moved, next] : [...moved.slice(0, at), next, ...moved.slice(at)];
    });
    timers.current.set(key, window.setTimeout(() => expire(key), UNDO_WINDOW_MS));
  }

  function undo(key: string) {
    const placeholder = placeholders.find(item => item.key === key);
    const exercise = draft.exercises[exerciseIndex];
    if (!placeholder || !exercise) return;
    const anchorAt = placeholder.anchorId === null ? -1 : exercise.sets.findIndex(set => set.id === placeholder.anchorId);
    const index = placeholder.anchorId !== null && anchorAt < 0 ? exercise.sets.length : anchorAt + 1;
    const restored = withSetRestored(draft, { ...placeholder.removal, index });
    if (!restored) return;
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    change(restored);
    setPlaceholders(current => {
      const position = current.findIndex(item => item.key === key);
      // Later placeholders that shared its anchor now follow the restored set.
      return current.filter(item => item.key !== key).map((item, i) =>
        i >= position && item.anchorId === placeholder.anchorId ? { ...item, anchorId: key } : item);
    });
  }

  /** The placeholders to show after a set (or before the first, for null), and any whose set is gone. */
  const after = (anchorId: string | null) => placeholders.filter(item => item.anchorId === anchorId);
  const orphaned = (exercise: SessionExercise) =>
    placeholders.filter(item => item.anchorId !== null && !exercise.sets.some(set => set.id === item.anchorId));

  return { hold, undo, after, orphaned };
}
