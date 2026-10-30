import { createContext, useContext } from 'react';
import type { Exercise, GymEquipmentItem, GymLaunch, GymsView } from '../types';

/// Whether the active gym can host an exercise. Missing equipment is advisory: a warning never
/// changes the plan, blocks a workout, or swaps an exercise by itself.
export type GymAvailability =
  | { available: true }
  | { available: false; gymName: string; missing: string[]; marked: boolean };

const AVAILABLE: GymAvailability = { available: true };

export type GymAvailabilityContextValue = {
  gym: GymLaunch | null;
  requires: ReadonlyMap<string, readonly string[]>;
  /** Takes a gyms response from any screen and brings warnings and load steps up to date. */
  apply?: (view: GymsView) => Promise<void>;
  switchGym?: (id: string) => Promise<void>;
  /** The server refuses a switch while a workout is open. */
  switchLocked?: boolean;
  /** False while a gym that lacks something waits for the catalog's requirements to arrive. */
  requirementsReady?: boolean;
};

export const GymAvailabilityContext = createContext<GymAvailabilityContextValue>({ gym: null, requires: new Map() });

/** A requirement lists alternatives separated by '|'; any one present satisfies it. */
const options = (requirement: string): string[] => requirement.split('|').map(key => key.trim()).filter(Boolean);

export function gymAvailability(gym: GymLaunch | null | undefined, exerciseId: string | null | undefined,
  requires: readonly string[] | undefined): GymAvailability {
  if (!gym || !exerciseId) return AVAILABLE;
  const override = gym.active.exerciseOverrides[exerciseId];
  if (override === 'available') return AVAILABLE;
  const gymName = gym.active.name;
  if (override === 'unavailable') return { available: false, gymName, missing: [], marked: true };
  const missing = new Set(gym.active.missingEquipment);
  const unmet = (requires ?? []).map(options).filter(keys => keys.length > 0 && keys.every(key => missing.has(key)));
  if (unmet.length === 0) return AVAILABLE;
  return { available: false, gymName, marked: false,
    missing: unmet.map(keys => keys.map(key => gym.missingLabels[key] ?? key).join(' or ')) };
}

/** One short sentence for a badge's accessible text or a tooltip. */
export function gymAvailabilityText(availability: GymAvailability): string {
  if (availability.available) return '';
  if (availability.marked) return `Marked unavailable at ${availability.gymName}`;
  return `${availability.gymName} has no ${availability.missing.join(', ')}`;
}

export function useGymAvailability(exerciseId: string | null | undefined): GymAvailability {
  const { gym, requires } = useContext(GymAvailabilityContext);
  return gymAvailability(gym, exerciseId, exerciseId ? requires.get(exerciseId) : undefined);
}

export function useGymAvailabilityCheck(): (exerciseId: string | null | undefined) => GymAvailability {
  const { gym, requires } = useContext(GymAvailabilityContext);
  return exerciseId => gymAvailability(gym, exerciseId, exerciseId ? requires.get(exerciseId) : undefined);
}

export function requirementsById(exercises: readonly Pick<Exercise, 'id' | 'requires'>[]): Map<string, readonly string[]> {
  return new Map(exercises.filter(exercise => exercise.requires?.length).map(exercise => [exercise.id, exercise.requires!]));
}

/** The name a warning gives an item: a machine built both ways says which build is missing. */
export const equipmentDisplayName = (item: GymEquipmentItem): string =>
  item.machine ? `${item.machine} (${item.label.toLowerCase()})` : item.label;

/** The launch shape of a gyms response, so a Settings edit updates warnings at once. */
export function gymLaunchFrom(view: GymsView): GymLaunch | null {
  const active = view.profiles.find(profile => profile.id === view.activeId);
  if (!active) return null;
  const missing = new Set(active.missingEquipment);
  return {
    active,
    profiles: view.profiles.map(({ id, name }) => ({ id, name })),
    missingLabels: Object.fromEntries(view.equipment.filter(item => missing.has(item.key)).map(item => [item.key, equipmentDisplayName(item)]))
  };
}

/** Keeps the server's order within each half: exercises this gym can host come first. */
export function availableFirst<T>(items: readonly T[], isAvailable: (item: T) => boolean): T[] {
  return [...items.filter(isAvailable), ...items.filter(item => !isAvailable(item))];
}
