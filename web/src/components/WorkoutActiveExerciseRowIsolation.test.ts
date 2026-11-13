import { describe, expect, it, vi } from 'vitest';
import type { Exercise, Session, SessionExercise } from '../types';
import { withLoggedSetEdit } from '../lib/liveAdjustment';

const cleanups = new Map<number, void | (() => void)>();
const prevDeps = new Map<number, unknown[] | undefined>();
const stateSlots: { value: unknown; setter: (next: unknown) => void }[] = [];
const refSlots: { current: unknown }[] = [];
const memoSlots: { value: unknown; deps?: unknown[] }[] = [];
let effectEntries: { effect: () => void | (() => void); deps?: unknown[] }[] = [];
let stateCursor = 0;
let refCursor = 0;
let memoCursor = 0;

function sameDeps(a?: unknown[], b?: unknown[]) {
  return Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useContext: <T>(ctx: { _currentValue?: T }) => ctx?._currentValue as T,
    useRef: <T>(initial: T) => {
      const index = refCursor++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index] as { current: T };
    },
    useCallback: <T>(callback: T, deps?: unknown[]) => {
      const index = memoCursor++;
      const slot = memoSlots[index];
      if (slot && sameDeps(slot.deps, deps)) return slot.value as T;
      memoSlots[index] = { value: callback, deps };
      return callback;
    },
    useMemo: <T>(factory: () => T, deps?: unknown[]) => {
      const index = memoCursor++;
      const slot = memoSlots[index];
      if (slot && sameDeps(slot.deps, deps)) return slot.value as T;
      const value = factory();
      memoSlots[index] = { value, deps };
      return value;
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      effectEntries.push({ effect, deps });
    },
    useState: <T>(initial: T) => {
      const index = stateCursor++;
      if (!stateSlots[index]) {
        const slot: { value: unknown; setter: (next: unknown) => void } = {
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
          setter: (next: unknown) => {
            slot.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
          }
        };
        stateSlots[index] = slot;
      }
      return [stateSlots[index].value as T, stateSlots[index].setter as (next: T) => void];
    }
  };
});

import { WorkoutActiveExercise } from './WorkoutActiveExercise';
import { WorkoutSetRow } from './WorkoutSetRow';
import { CardFeedback } from './ui/CardFeedback';

function findFeedback(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(findFeedback);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const found = el.type === CardFeedback && el.props ? [el.props] : [];
  return el.props?.children ? [...found, ...findFeedback(el.props.children)] : found;
}

function findSetRows(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(findSetRows);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const found = el.type === WorkoutSetRow && el.props ? [el.props] : [];
  return el.props?.children ? [...found, ...findSetRows(el.props.children)] : found;
}

function shallowEqualProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => Object.is(a[key], b[key]));
}

const bench: Exercise = {
  id: 'ex-bench', slug: 'bench-press', name: 'Bench press', muscle: 'Chest', equipment: 'Barbell',
  aliases: [], loadStepKg: 2.5, loadModel: 'external', source: 'catalog', isCustom: false
};

const makePrescription = () => ({
  repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: null, warmup: false,
  repsSource: 'extracted' as const, rpeSource: 'extracted' as const, restSource: 'extracted' as const
});

const baseExercise: SessionExercise = {
  id: 'se-1', exerciseId: 'ex-bench', name: 'Bench press', position: 0, note: '', loadModel: 'external',
  prescription: [makePrescription(), makePrescription(), makePrescription()],
  sets: [
    { id: 'set-1', position: 0, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false },
    { id: 'set-2', position: 1, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false },
    { id: 'set-3', position: 2, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false }
  ],
  sequenceGroup: '', substitutions: [], progression: null
};

function renderWithDraft(draft: Session, props: { editSet?: () => void; change?: (next: Session) => void; toggle?: () => void; index?: number }) {
  stateCursor = 0; refCursor = 0; memoCursor = 0; effectEntries = [];
  const index = props.index ?? 0;
  return findSetRows(WorkoutActiveExercise({
    exercise: draft.exercises[index], index, unit: 'kg', draft, exercises: [bench],
    change: props.change ?? (() => undefined), editSet: props.editSet ?? (() => undefined), toggle: props.toggle ?? (() => undefined),
    onSwap: async () => undefined, onRemoveExercise: () => undefined
  }));
}

describe('WorkoutActiveExercise set row isolation', () => {
  it('shows the set-order warning beside the attempted row and clears it when the blocker is logged', () => {
    stateSlots.length = 0; refSlots.length = 0; memoSlots.length = 0;
    const warmup = { ...baseExercise.sets[0], warmup: true };
    const current = { ...baseExercise, sets: [warmup, baseExercise.sets[1]] };
    const draft = { id: 's1', exercises: [current], pausedAt: null } as Session;
    const toggle = vi.fn();
    const rows = renderWithDraft(draft, { toggle });
    expect((rows[1].toggle as (ei: number, si: number) => unknown)(0, 1)).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    stateCursor = 0; refCursor = 0; memoCursor = 0;
    const render = (session: Session) => WorkoutActiveExercise({
      exercise: session.exercises[0], index: 0, unit: 'kg', draft: session, exercises: [bench],
      change: () => undefined, editSet: () => undefined, toggle,
      onSwap: async () => undefined, onRemoveExercise: () => undefined
    });
    expect(findFeedback(render(draft)).map(feedback => feedback.message)).toContain('Log warm-up 1 first, or remove it if you are skipping it.');
    stateCursor = 0; refCursor = 0; memoCursor = 0;
    const resolved = { ...draft, exercises: [{ ...current, sets: [{ ...warmup, done: true }, current.sets[1]] }] };
    expect(findFeedback(render(resolved))).toHaveLength(0);
  });

  it('keeps sibling WorkoutSetRow props shallowly equal across single-set edits and uses default memo comparison', () => {
    for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup();
    cleanups.clear(); prevDeps.clear(); stateSlots.length = 0; refSlots.length = 0; memoSlots.length = 0;

    expect((WorkoutSetRow as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
    expect((WorkoutSetRow as { compare?: unknown }).compare ?? null).toBeNull();

    const draft1: Session = {
      id: 's1', templateId: null, programId: null, name: 'Push', note: '', active: true,
      startedAt: '2026-11-09T10:00:00Z', finishedAt: null, pausedAt: null, revision: 1,
      exercises: [baseExercise], volumeKg: null, completedSets: 0, warmupSets: 0
    };
    const change = vi.fn();
    const editSet = vi.fn();
    const toggle = vi.fn();

    const rows1 = renderWithDraft(draft1, { change, editSet, toggle });
    expect(rows1).toHaveLength(3);

    const draft2 = withLoggedSetEdit(draft1, 0, 0, { weightKg: 82.5 }, [bench], 'kg', false, new Map(), new Map())!;
    expect(draft2).not.toBeNull();

    // Pass new callback closures on parent re-render to ensure row isolation still holds via rowActions.
    const rows2 = renderWithDraft(draft2, { change: vi.fn(change), editSet: vi.fn(), toggle: vi.fn() });
    expect(shallowEqualProps(rows1[0], rows2[0])).toBe(false);
    expect(shallowEqualProps(rows1[1], rows2[1])).toBe(true);
    expect(shallowEqualProps(rows1[2], rows2[2])).toBe(true);

    // Paused updates must reach every row so locked controls never stay stale.
    const pausedDraft: Session = { ...draft2, pausedAt: '2026-11-09T10:05:00Z' };
    const pausedRows = renderWithDraft(pausedDraft, { change, editSet, toggle });
    expect(pausedRows.every(row => row.paused === true)).toBe(true);
    expect(shallowEqualProps(rows2[1], pausedRows[1])).toBe(false);

    // Stable handlers read latest draft/index via liveActions.current instead of stale closures.
    (rows1[1].onSetType as (si: number, type: 'dropset') => void)(1, 'dropset');
    expect(change).toHaveBeenCalledTimes(1);
    const updatedByRowAction = change.mock.calls[0][0] as Session;
    expect(updatedByRowAction.pausedAt).toBe('2026-11-09T10:05:00Z');
    expect(updatedByRowAction.exercises[0].sets[0].weightKg).toBe(82.5);
  });
});
