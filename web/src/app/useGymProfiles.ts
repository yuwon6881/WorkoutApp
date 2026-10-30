import { useEffect } from 'react';
import { api } from '../lib/api';
import { gymLaunchFrom, requirementsById, type GymAvailabilityContextValue } from '../lib/gymAvailability';
import type { AppState } from './useApp';
import type { GymsView } from '../types';

/// The active gym as the whole app sees it: warnings everywhere, and a switch from Settings, the
/// start preview, or an exercise's details that brings catalog and template load steps along.
export function useGymProfiles(app: AppState): GymAvailabilityContextValue {
  const { data } = app;
  // Missing-equipment warnings read each exercise's requirements from the catalog, so an open
  // workout at a gym that lacks something loads it; a gym that lacks nothing never needs it.
  const gymLacksEquipment = Boolean(data?.gym?.active.missingEquipment.length);
  useEffect(() => {
    if (data?.activeWorkout && gymLacksEquipment && !data.resources?.catalog) void app.ensureResources(['catalog']);
  }, [data?.account.id, data?.activeWorkout?.id, gymLacksEquipment]);

  // A gym change moves catalog and template load steps; the launch read refetches what changed.
  const apply = async (view: GymsView) => {
    app.setData(current => ({ ...current, gym: gymLaunchFrom(view) }));
    await app.reload();
  };
  return {
    gym: data?.gym ?? null,
    requires: requirementsById(data?.exercises ?? []),
    switchLocked: Boolean(data?.activeWorkout),
    // A failed catalog read stops the wait: the screen shows without warnings rather than never.
    requirementsReady: !gymLacksEquipment || Boolean(data?.resources?.catalog || data?.loadedResources?.catalog || app.resourceError),
    apply,
    switchGym: async id => { await apply(await api.activateGym(id)); }
  };
}
