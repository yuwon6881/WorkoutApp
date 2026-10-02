import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { sharedReads } from './readCoordinator';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sharedReads.reset(); });

it('uses the compatible launch shell only when the new endpoint is absent', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  const shell: Awaited<ReturnType<typeof api.shell>> = { account: { id: 'owner', displayName: 'Owner' },
    preferences: { unit: 'kg', theme: 'dark', restAlerts: true }, activeWorkout: null, imports: [],
    activeProgram: null, nextWorkout: null, navigationCounts: { programs: 0, templates: 0 } };
  const fallback = vi.spyOn(api, 'shell').mockResolvedValue(shell);
  const signal = new AbortController().signal;
  expect(await api.launch(signal)).toBe(shell);
  expect(fallback).toHaveBeenCalledWith(signal);
});

it('keeps authorization failures authoritative instead of using the older shell', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
  const fallback = vi.spyOn(api, 'shell');
  await expect(api.launch()).rejects.toMatchObject({ status: 403 });
  expect(fallback).not.toHaveBeenCalled();
});

it('preserves the bounded legacy past-sets read and cancellation during backend rollout', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  const insight = vi.spyOn(api, 'exerciseInsight').mockResolvedValue({ history: [
    { sessionId: 'completed', finishedAt: '2026-10-02T08:00:00Z' },
    { sessionId: 'active', finishedAt: null }
  ] } as Awaited<ReturnType<typeof api.exerciseInsight>>);
  const session: Awaited<ReturnType<typeof api.getWorkout>> = { id: 'completed', templateId: null, programId: null,
    name: 'Completed', note: '', active: false, startedAt: '2026-10-02T07:00:00Z', finishedAt: '2026-10-02T08:00:00Z',
    revision: 1, exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0 };
  const detail = vi.spyOn(api, 'getWorkout').mockResolvedValue(session);
  const signal = new AbortController().signal;
  expect(await api.recentExerciseSets('exercise', signal)).toEqual([session]);
  expect(insight).toHaveBeenCalledWith('exercise', 'all', 0, 3, signal);
  expect(detail).toHaveBeenCalledOnce();
  expect(detail).toHaveBeenCalledWith('completed', signal);
});
