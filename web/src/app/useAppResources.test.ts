import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, ProgramSummary, Template } from '../types';
import { api } from '../lib/api';

const { originalWindowDescriptor, originalNavigatorDescriptor } = vi.hoisted(() => {
  const origWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  if (typeof globalThis.window === 'undefined') {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const windowStub = {
      location: { pathname: '/', search: '' },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        let bucket = listeners.get(type);
        if (!bucket) {
          bucket = new Set();
          listeners.set(type, bucket);
        }
        bucket.add(listener);
      },
      removeEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent: (_event: unknown) => true
    };
    Object.defineProperty(globalThis, 'window', {
      value: windowStub,
      writable: true,
      configurable: true
    });
  }

  if (typeof globalThis.navigator === 'undefined') {
    const navigatorStub = { onLine: true };
    Object.defineProperty(globalThis, 'navigator', {
      value: navigatorStub,
      writable: true,
      configurable: true
    });
  }

  return { originalWindowDescriptor: origWinDesc, originalNavigatorDescriptor: origNavDesc };
});

const stateHolders: { value: unknown; setter: (v: unknown) => void }[] = [];
let stateIndex = 0;

vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: () => undefined,
  useState: <T>(initial: T) => {
    const idx = stateIndex++;
    if (!stateHolders[idx]) {
      const holder: { value: unknown; setter: (next: unknown) => void } = {
        value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter: (next: unknown) => {
          holder.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(holder.value) : next;
        }
      };
      stateHolders[idx] = holder;
    }
    return [stateHolders[idx].value as T, stateHolders[idx].setter as (val: T) => void];
  }
}));

import { useApp } from './useApp';

function mockBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    account: { id: 'user-1', displayName: 'Lifter' },
    preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
    exercises: [],
    templates: [{
      id: 't-old', programId: null, name: 'Old Template', focus: '', note: '', week: 1, position: 0,
      revision: 1, block: '', phase: '', phaseWeek: 1, isRestDay: false, exercises: []
    }],
    programs: [{
      id: 'p-old', name: 'Old Program', weeks: 1, active: false, revision: 1, sourceImportId: null,
      days: [], completedTemplateIds: [], nextTemplateId: null, progress: null
    }],
    activeProgram: null,
    activeWorkout: null,
    history: { total: 0, page: 0, size: 20, sessions: [] },
    resources: { programs: true, templates: true },
    imports: [],
    ...overrides
  };
}

function initAppWithData(data: Bootstrap) {
  stateHolders.length = 0;
  stateIndex = 0;
  const holder: { value: unknown; setter: (next: unknown) => void } = {
    value: data,
    setter: (next: unknown) => {
      holder.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(holder.value) : next;
    }
  };
  stateHolders[0] = holder;
  return useApp();
}

afterEach(() => {
  stateHolders.length = 0;
  stateIndex = 0;
  vi.restoreAllMocks();
});

afterAll(() => {
  if (originalWindowDescriptor === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  }
  if (originalNavigatorDescriptor === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator;
  } else {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  }
});

describe('useApp ensureResources force refresh', () => {
  it('skips loading when resource is already marked loaded and force is false', async () => {
    const programsSpy = vi.spyOn(api, 'programs').mockResolvedValue([]);
    const templatesSpy = vi.spyOn(api, 'templates').mockResolvedValue([]);

    const app = initAppWithData(mockBootstrap({ resources: { programs: true, templates: true } }));
    await app.ensureResources(['programs', 'templates']);

    expect(programsSpy).not.toHaveBeenCalled();
    expect(templatesSpy).not.toHaveBeenCalled();
  });

  it('forces a fresh read bypassing already-loaded resources cache when force is true', async () => {
    const freshPrograms: ProgramSummary[] = [{
      id: 'p-fresh', name: 'Fresh Program', weeks: 1, active: false, revision: 2, sourceImportId: null,
      days: [], completedTemplateIds: [], nextTemplateId: null, progress: null
    }];
    const freshTemplates: Template[] = [{
      id: 't-fresh', programId: null, name: 'Fresh Template', focus: '', note: '', week: 1, position: 0,
      revision: 2, block: '', phase: '', phaseWeek: 1, isRestDay: false, exercises: []
    }];

    const programsSpy = vi.spyOn(api, 'programs').mockResolvedValue(freshPrograms);
    const templatesSpy = vi.spyOn(api, 'templates').mockResolvedValue(freshTemplates);

    const app = initAppWithData(mockBootstrap({ resources: { programs: true, templates: true } }));
    await app.ensureResources(['programs', 'templates'], true, true);

    expect(programsSpy).toHaveBeenCalledTimes(1);
    expect(templatesSpy).toHaveBeenCalledTimes(1);

    const updated = stateHolders[0].value as Bootstrap;
    expect(updated.programs).toEqual(freshPrograms);
    expect(updated.templates).toEqual(freshTemplates);
    expect(updated.resources?.programs).toBe(true);
    expect(updated.resources?.templates).toBe(true);
  });

  it('deduplicates concurrent force requests sharing the same in-flight fetch', async () => {
    let resolvePrograms!: (val: ProgramSummary[]) => void;
    const pendingPrograms = new Promise<ProgramSummary[]>(resolve => { resolvePrograms = resolve; });
    const programsSpy = vi.spyOn(api, 'programs').mockReturnValue(pendingPrograms);

    const app = initAppWithData(mockBootstrap({ resources: { programs: true } }));
    const flight1 = app.ensureResources(['programs'], true, true);
    const flight2 = app.ensureResources(['programs'], true, true);

    expect(programsSpy).toHaveBeenCalledTimes(1);

    resolvePrograms([]);
    await Promise.all([flight1, flight2]);
  });

  it('propagates failure when throwOnError is true on forced read', async () => {
    vi.spyOn(api, 'programs').mockRejectedValue(new Error('Network failure'));

    const app = initAppWithData(mockBootstrap({ resources: { programs: true } }));
    await expect(app.ensureResources(['programs'], true, true)).rejects.toThrow('Network failure');
  });
});
