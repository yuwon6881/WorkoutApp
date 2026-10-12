import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramSummary, Template } from '../types';
import type { SlotItem } from '../lib/activeSlot';
import { useWorkoutSlotActions } from './useWorkoutSlotActions';
import { api, ApiError } from '../lib/api';
import { activeSlotApi } from '../lib/api/activeSlot';

// Stable React hook mocks matching the existing useImportDraftSaver.test.ts pattern
const stateHolders: { value: unknown; setter: (v: unknown) => void }[] = [];
let stateIndex = 0;

vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useState: <T>(initial: T) => {
    const idx = stateIndex++;
    if (!stateHolders[idx]) {
      const holder: { value: unknown; setter: (next: unknown) => void } = {
        value: initial,
        setter: (next: unknown) => {
          holder.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(holder.value) : next;
        }
      };
      stateHolders[idx] = holder;
    }
    return [stateHolders[idx].value as T, stateHolders[idx].setter as (val: T) => void];
  }
}));

afterEach(() => {
  stateHolders.length = 0;
  stateIndex = 0;
  vi.restoreAllMocks();
});

function mockProgram(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: 'p1',
    name: 'Strength Program',
    weeks: 4,
    active: true,
    revision: 1,
    sourceImportId: null,
    completedTemplateIds: [],
    nextTemplateId: 'd1',
    lifecycleStatus: 'active',
    days: [
      { id: 'd1', name: 'Day 1', focus: '', block: '', phase: '', week: 1, phaseWeek: 1, position: 0, isRestDay: false, exerciseCount: 3 },
      { id: 'd2', name: 'Day 2', focus: '', block: '', phase: '', week: 2, phaseWeek: 2, position: 0, isRestDay: false, exerciseCount: 3 }
    ],
    progress: { runId: 'r1', currentWeek: 1, currentAttempt: 1, passedDays: 0, totalDays: 2, days: [] },
    ...overrides
  };
}

function mockTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1',
    programId: null,
    name: 'Upper Body Workout',
    focus: 'Hypertrophy',
    note: '',
    week: 1,
    position: 0,
    revision: 1,
    block: '',
    phase: '',
    phaseWeek: 1,
    isRestDay: false,
    exercises: [],
    ...overrides
  };
}

describe('useWorkoutSlotActions', () => {
  it('keeps busy true until deferred onChanged explicitly resolves (no sleeps)', async () => {
    let signalChangedStart!: () => void;
    const changedStarted = new Promise<void>(resolve => { signalChangedStart = resolve; });
    let releaseChanged!: () => void;
    const changedFinished = new Promise<void>(resolve => { releaseChanged = resolve; });

    const onChanged = vi.fn(() => {
      signalChangedStart();
      return changedFinished;
    });
    vi.spyOn(activeSlotApi, 'setTemplateActive').mockResolvedValue(mockTemplate({ active: true }));

    const templateItem: SlotItem = { kind: 'template', template: mockTemplate({ id: 't2', active: false }) };
    stateIndex = 0;
    const actions = useWorkoutSlotActions({ holder: null, onChanged });

    actions.activate(templateItem);
    // Wait until perform has finished running the mutation and entered onChanged
    await changedStarted;

    // In our test harness, stateHolders[0] is busy
    expect(stateHolders[0].value).toBe(true);
    expect(activeSlotApi.setTemplateActive).toHaveBeenCalledWith('t2', true, 1);
    expect(onChanged).toHaveBeenCalled();

    // Still busy while onChanged has not finished
    expect(stateHolders[0].value).toBe(true);

    releaseChanged();
    await vi.waitFor(() => {
      expect(stateHolders[0].value).toBe(false);
    });
  });

  it('prompts confirmation without API mutation when activating over genuine progress', () => {
    const progressedProgram: SlotItem = {
      kind: 'program',
      program: mockProgram({
        active: true,
        progress: { runId: 'r1', currentWeek: 2, currentAttempt: 1, passedDays: 2, totalDays: 4, days: [] }
      })
    };
    const incoming: SlotItem = { kind: 'template', template: mockTemplate({ id: 't2', name: 'Leg Day', active: false }) };
    const setProgramSpy = vi.spyOn(api, 'setProgramActive').mockResolvedValue({ ...mockProgram(), workouts: [] });
    const setTemplateSpy = vi.spyOn(activeSlotApi, 'setTemplateActive').mockResolvedValue(mockTemplate());

    stateIndex = 0;
    const actions = useWorkoutSlotActions({ holder: progressedProgram, onChanged: async () => undefined });
    actions.activate(incoming);

    // Confirmation state is stateHolders[2]
    const confirmation = stateHolders[2].value as { title: string; action: string } | null;
    expect(confirmation).not.toBeNull();
    expect(confirmation?.title).toBe('Replace Strength Program?');
    expect(confirmation?.action).toBe('Replace and forget progress');

    // Genuine progress replacement check must NOT mutate API
    expect(setProgramSpy).not.toHaveBeenCalled();
    expect(setTemplateSpy).not.toHaveBeenCalled();
  });

  it('activates incoming template once moved to library and rerendered with raw holder null', async () => {
    const progressedProgram: SlotItem = {
      kind: 'program',
      program: mockProgram({
        active: true,
        progress: { runId: 'r1', currentWeek: 2, currentAttempt: 1, passedDays: 2, totalDays: 4, days: [] }
      })
    };
    const incoming: SlotItem = { kind: 'template', template: mockTemplate({ id: 't2', name: 'Leg Day', active: false }) };
    const setProgramSpy = vi.spyOn(api, 'setProgramActive').mockResolvedValue({ ...mockProgram({ active: false }), workouts: [] });
    const setTemplateSpy = vi.spyOn(activeSlotApi, 'setTemplateActive').mockResolvedValue(mockTemplate({ id: 't2', active: true }));

    // 1. Lifter moves progressed program to library
    stateIndex = 0;
    let actions = useWorkoutSlotActions({ holder: progressedProgram, onChanged: async () => undefined });
    actions.moveToLibrary(progressedProgram);

    // Confirmation requested for moving progressed program
    const moveConfirm = stateHolders[2].value as { title: string; run: () => Promise<unknown> };
    expect(moveConfirm?.title).toBe('Move Strength Program to the library?');

    // Confirm the move
    stateIndex = 0;
    actions = useWorkoutSlotActions({ holder: progressedProgram, onChanged: async () => undefined });
    actions.confirm();
    await vi.waitFor(() => {
      expect(setProgramSpy).toHaveBeenCalledWith('p1', false, 1);
    });

    // 2. Authoritative update completes and rerenders with holder = null
    stateIndex = 0;
    actions = useWorkoutSlotActions({ holder: null, onChanged: async () => undefined });

    // 3. Lifter activates incoming template
    actions.activate(incoming);
    await vi.waitFor(() => {
      expect(setTemplateSpy).toHaveBeenCalledWith('t2', true, 1);
    });

    // Must activate without confirmation prompt
    expect(stateHolders[2].value).toBeNull();
  });

  it('rolls back optimistic state and records error upon failed mutation', async () => {
    vi.spyOn(activeSlotApi, 'setTemplateActive').mockRejectedValue(new ApiError('Failed to activate workout', 500));
    const templateItem: SlotItem = { kind: 'template', template: mockTemplate({ id: 't1', active: false }) };

    stateIndex = 0;
    const actions = useWorkoutSlotActions({ holder: null, onChanged: async () => undefined });

    actions.activate(templateItem);

    await vi.waitFor(() => {
      // Error state is stateHolders[1], optimistic is stateHolders[3]
      expect(stateHolders[1].value).toBe('Failed to activate workout');
      expect(stateHolders[3].value).toBeNull();
      expect(stateHolders[0].value).toBe(false);
    });
  });

  it('guards overlapping actions via synchronous busy latch and ignores overlapping drop/activate', async () => {
    let signalChangedStart!: () => void;
    const changedStarted = new Promise<void>(resolve => { signalChangedStart = resolve; });
    let releaseChanged!: () => void;
    const changedFinished = new Promise<void>(resolve => { releaseChanged = resolve; });

    const onChanged = vi.fn(() => {
      signalChangedStart();
      return changedFinished;
    });
    const setTemplateSpy = vi.spyOn(activeSlotApi, 'setTemplateActive').mockResolvedValue(mockTemplate());

    const item1: SlotItem = { kind: 'template', template: mockTemplate({ id: 't1', active: false }) };
    const item2: SlotItem = { kind: 'template', template: mockTemplate({ id: 't2', active: false }) };

    stateIndex = 0;
    const actions = useWorkoutSlotActions({ holder: null, onChanged });

    // First action begins
    actions.activate(item1);

    // Wait until first action has entered onChanged and is holding busy latch
    await changedStarted;

    // Attempt second overlapping action (e.g. drop or menu click while busy)
    actions.drop(item2, 'library', 'active');
    actions.activate(item2);

    // Only first action was processed; overlap was synchronously ignored by busyRef
    expect(setTemplateSpy).toHaveBeenCalledTimes(1);
    expect(setTemplateSpy).toHaveBeenCalledWith('t1', true, 1);

    releaseChanged();
    await vi.waitFor(() => {
      expect(stateHolders[0].value).toBe(false);
    });
  });
});
