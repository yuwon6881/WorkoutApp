import { describe, expect, it } from 'vitest';
import type { GymLaunch, GymsView } from '../types';
import { availableFirst, gymAvailability, gymAvailabilityText, gymLaunchFrom, requirementsById } from './gymAvailability';

const gym = (missing: string[], overrides: GymLaunch['active']['exerciseOverrides'] = {}): GymLaunch => ({
  active: { id: 'g1', name: 'Hotel', missingEquipment: missing, exerciseOverrides: overrides, revision: 1, active: true },
  profiles: [{ id: 'g1', name: 'Hotel' }],
  missingLabels: { 'leg-press.plate': 'Leg press (plate-loaded)', 'leg-press.stack': 'Leg press (weight stack)', 'adjustable-bench': 'Adjustable bench' }
});

describe('gymAvailability', () => {
  it('is available when nothing is known about the gym or the exercise', () => {
    expect(gymAvailability(null, 'x', ['barbell']).available).toBe(true);
    expect(gymAvailability(gym(['barbell']), null, ['barbell']).available).toBe(true);
    expect(gymAvailability(gym(['barbell']), 'x', undefined).available).toBe(true);
  });

  it('names every requirement the gym cannot meet', () => {
    const result = gymAvailability(gym(['leg-press.plate', 'adjustable-bench']), 'x', ['leg-press.plate', 'adjustable-bench', 'dumbbells']);
    expect(result).toEqual({ available: false, gymName: 'Hotel', marked: false, missing: ['Leg press (plate-loaded)', 'Adjustable bench'] });
    expect(gymAvailabilityText(result)).toBe('Hotel has no Leg press (plate-loaded), Adjustable bench');
  });

  it('meets a requirement with any of its alternatives', () => {
    expect(gymAvailability(gym(['leg-press.plate']), 'x', ['leg-press.plate|leg-press.stack']).available).toBe(true);
    const neither = gymAvailability(gym(['leg-press.plate', 'leg-press.stack']), 'x', ['leg-press.plate|leg-press.stack']);
    expect(neither).toEqual({ available: false, gymName: 'Hotel', marked: false, missing: ['Leg press (plate-loaded) or Leg press (weight stack)'] });
  });

  it('lets an exercise choice override the equipment either way', () => {
    expect(gymAvailability(gym(['leg-press.plate'], { x: 'available' }), 'x', ['leg-press.plate']).available).toBe(true);
    const marked = gymAvailability(gym([], { x: 'unavailable' }), 'x', []);
    expect(gymAvailabilityText(marked)).toBe('Marked unavailable at Hotel');
  });
});

describe('gymLaunchFrom', () => {
  it('labels the active gym\'s missing items the way the server does', () => {
    const view: GymsView = {
      activeId: 'g2',
      profiles: [
        { id: 'g1', name: 'Home', missingEquipment: [], exerciseOverrides: {}, revision: 1, active: false },
        { id: 'g2', name: 'Hotel', missingEquipment: ['leg-press.stack'], exerciseOverrides: {}, revision: 2, active: true }
      ],
      equipment: [{ key: 'leg-press.stack', label: 'Weight stack', group: 'machines', machine: 'Leg press', variant: 'stack' }]
    };
    expect(gymLaunchFrom(view)).toEqual({
      active: view.profiles[1], profiles: [{ id: 'g1', name: 'Home' }, { id: 'g2', name: 'Hotel' }],
      missingLabels: { 'leg-press.stack': 'Leg press (weight stack)' }
    });
  });
});

describe('requirementsById', () => {
  it('keeps only exercises that need something', () => {
    const map = requirementsById([{ id: 'a', requires: ['barbell'] }, { id: 'b', requires: [] }, { id: 'c' }]);
    expect([...map]).toEqual([['a', ['barbell']]]);
  });
});

describe('gymLaunchFrom without its active gym', () => {
  it('reports no gym rather than guessing one', () => {
    expect(gymLaunchFrom({ activeId: 'gone', equipment: [],
      profiles: [{ id: 'g1', name: 'Home', missingEquipment: [], exerciseOverrides: {}, revision: 1, active: false }] })).toBeNull();
  });
});

describe('availableFirst', () => {
  it('moves unavailable items to the end without reordering either half', () => {
    expect(availableFirst([1, 2, 3, 4, 5], value => value % 2 === 0)).toEqual([2, 4, 1, 3, 5]);
  });
});
