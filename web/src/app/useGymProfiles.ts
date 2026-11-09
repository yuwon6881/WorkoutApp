import { useCallback, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { gymLaunchFrom, requirementsById, type GymAvailabilityContextValue } from '../lib/gymAvailability';
import type { AppState } from './useApp';
import type { GymsView } from '../types';

/// The active gym as the whole app sees it: warnings everywhere, and a switch from Settings, the
/// start preview, or an exercise's details that brings catalog and template load steps along.
export function useGymProfiles(app: AppState): GymAvailabilityContextValue {
  const { data, setData, reload } = app;
  // Missing-equipment warnings read each exercise's requirements from the catalog, so an open
  // workout at a gym that lacks something loads it; a gym that lacks nothing never needs it.
  const gymLacksEquipment = Boolean(data?.gym?.active.missingEquipment.length);
  useEffect(() => {
    if (data?.activeWorkout && gymLacksEquipment && !data.resources?.catalog) void app.ensureResources(['catalog']);
  }, [data?.account.id, data?.activeWorkout?.id, gymLacksEquipment]);

  // A gym change moves catalog and template load steps; the launch read refetches what changed.
  const apply = useCallback(async (view: GymsView) => {
    setData(current => ({ ...current, gym: gymLaunchFrom(view) }));
    await reload();
  }, [setData, reload]);
  const requires = useMemo(() => requirementsById(data?.exercises ?? []), [data?.exercises]);
  const switchGym = useCallback(async (id: string) => { await apply(await api.activateGym(id)); }, [apply]);
  const switchLocked = Boolean(data?.activeWorkout);
  const requirementsReady = !gymLacksEquipment || Boolean(data?.resources?.catalog || data?.loadedResources?.catalog || app.resourceError);
  return useMemo(() => ({
    gym: data?.gym ?? null,
    requires,
    switchLocked,
    // A failed catalog read stops the wait: the screen shows without warnings rather than never.
    requirementsReady,
    apply,
    switchGym
  }), [data?.gym, requires, switchLocked, requirementsReady, apply, switchGym]);
}
