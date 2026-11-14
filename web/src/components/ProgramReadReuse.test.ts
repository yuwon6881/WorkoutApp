import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Program, ProgramSummary } from '../types';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';

let currentScope: string | null = '["acc-1",{"programs":1}]';
let effectEntries: { effect: () => void | (() => void); deps?: unknown[] }[] = [];
const cleanups = new Map<number, void | (() => void)>();
const prevDeps = new Map<number, unknown[] | undefined>();
const stateSlots: { value: unknown; setter: (next: unknown) => void }[] = [];
const refSlots: { current: unknown }[] = [];
const memoSlots: { value: unknown; deps?: unknown[] }[] = [];
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
    useContext: () => currentScope,
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

import { ActiveProgramCard } from './ActiveProgramCard';
import { LibraryProgramCard } from './LibraryProgramCard';

function resetHookState() {
  for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup();
  cleanups.clear();
  prevDeps.clear();
  stateSlots.length = 0;
  refSlots.length = 0;
  memoSlots.length = 0;
  effectEntries = [];
  stateCursor = 0;
  refCursor = 0;
  memoCursor = 0;
}

function flushEffects() {
  effectEntries.forEach((entry, index) => {
    if (!prevDeps.has(index) || !sameDeps(prevDeps.get(index), entry.deps)) {
      const previous = cleanups.get(index);
      if (typeof previous === 'function') previous();
      cleanups.set(index, entry.effect());
      prevDeps.set(index, entry.deps);
    }
  });
}

function findAll(node: unknown, predicate: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean): { type?: unknown; props?: Record<string, unknown> }[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate));
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const matches = predicate(element) ? [element] : [];
  if (element.props?.children) matches.push(...findAll(element.props.children, predicate));
  return matches;
}

const sampleProgram: ProgramSummary = {
  id: 'prog-1',
  name: 'Upper Lower',
  weeks: 4,
  active: true,
  revision: 1,
  sourceImportId: null,
  completedTemplateIds: [],
  nextTemplateId: 'day-1',
  lifecycleStatus: 'active',
  days: [
    { id: 'day-1', name: 'Day One', focus: 'Push', block: 'Block 1', phase: 'Base', week: 1, phaseWeek: 1, position: 0, isRestDay: false, exerciseCount: 1 }
  ],
  progress: {
    runId: 'run-1',
    currentWeek: 1,
    currentAttempt: 1,
    passedDays: 0,
    totalDays: 1,
    days: [{ templateId: 'day-1', status: 'pending', isRestDay: false, position: 0 }]
  }
};

const sampleDetail: Program = {
  id: 'prog-1',
  name: 'Upper Lower',
  weeks: 4,
  active: true,
  revision: 1,
  sourceImportId: null,
  completedTemplateIds: [],
  nextTemplateId: 'day-1',
  lifecycleStatus: 'active',
  days: sampleProgram.days,
  progress: sampleProgram.progress,
  workouts: [{
    id: 'day-1',
    programId: 'prog-1',
    name: 'Day One',
    focus: 'Push',
    note: '',
    week: 1,
    position: 0,
    revision: 1,
    block: 'Block 1',
    phase: 'Base',
    phaseWeek: 1,
    isRestDay: false,
    active: false,
    activeCompletedAt: null,
    exercises: []
  }]
};

function renderActive(program = sampleProgram, onChanged = vi.fn(async () => {})) {
  stateCursor = 0;
  refCursor = 0;
  memoCursor = 0;
  effectEntries = [];
  const tree = ActiveProgramCard({
    program,
    exercises: [],
    onStart: () => {},
    onPreview: () => {},
    onChanged,
    onEdit: () => {},
    hasActiveWorkout: false,
    actions: { busy: false, onMoveToLibrary: () => {}, onRestart: () => {}, onDelete: () => {} },
    dragProps: {},
    moving: false,
    dragging: false
  });
  flushEffects();
  return tree;
}

function renderLibrary(program = { ...sampleProgram, active: false }) {
  stateCursor = 0;
  refCursor = 0;
  memoCursor = 0;
  effectEntries = [];
  const tree = LibraryProgramCard({
    program,
    exercises: [],
    busy: false,
    onActivate: () => {},
    onEdit: () => {},
    onDelete: () => {},
    dragProps: {},
    dragging: false
  });
  flushEffects();
  return tree;
}

afterEach(() => {
  resetHookState();
  currentScope = '["acc-1",{"programs":1}]';
  viewReadCache.reset();
  vi.restoreAllMocks();
});

describe('Program detail read reuse and recovery isolation', () => {
  it('calls detail.refresh rather than savePending when retrying a failed ActiveProgramCard read', async () => {
    const getProgram = vi.spyOn(api, 'getProgram')
      .mockRejectedValueOnce(new Error('Program fetch failed'))
      .mockResolvedValueOnce(sampleDetail);
    const updateTemplate = vi.spyOn(api, 'updateTemplate');
    const onChanged = vi.fn(async () => {});

    let tree = renderActive(sampleProgram, onChanged);
    await new Promise(resolve => setTimeout(resolve, 0));
    tree = renderActive(sampleProgram, onChanged);

    const feedback = findAll(tree, el => Boolean(el.props && 'message' in el.props && 'action' in el.props))[0];
    expect(feedback).toBeDefined();
    const action = feedback.props!.action as { label: string; onClick: () => void };
    expect(action.label).toBe('Retry refresh');

    action.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getProgram).toHaveBeenCalledTimes(2);
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('skips fetching LibraryProgramCard until expanded, reuses cached detail on remount, and invalidates on revision change', async () => {
    const getProgram = vi.spyOn(api, 'getProgram').mockResolvedValue(sampleDetail);

    let tree = renderLibrary();
    expect(getProgram).not.toHaveBeenCalled();

    const header = findAll(tree, el => Boolean(el.props && 'onToggle' in el.props))[0];
    (header.props!.onToggle as () => void)();
    tree = renderLibrary();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getProgram).toHaveBeenCalledTimes(1);

    // Remount at the same revision and expand: cached snapshot renders with 0 extra fetches.
    resetHookState();
    tree = renderLibrary();
    const headerRemount = findAll(tree, el => Boolean(el.props && 'onToggle' in el.props))[0];
    (headerRemount.props!.onToggle as () => void)();
    tree = renderLibrary();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getProgram).toHaveBeenCalledTimes(1);

    // Bump revision: stale detail invalidates and refetches.
    renderLibrary({ ...sampleProgram, active: false, revision: 2 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getProgram).toHaveBeenCalledTimes(2);
  });
});
