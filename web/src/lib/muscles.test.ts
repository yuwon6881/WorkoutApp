import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types';
import { getWorkoutMuscles } from './muscles';

describe('getWorkoutMuscles', () => {
  const catalog: Exercise[] = [
    {
      id: 'ex-1',
      slug: 'barbell-bench-press',
      name: 'Barbell Bench Press',
      muscle: 'Chest',
      equipment: 'Barbell',
      cue: '',
      aliases: ['Bench Press'],
      loadStepKg: 2.5
    },
    {
      id: 'ex-2',
      slug: 'bicep-curl',
      name: 'Dumbbell Curl',
      muscle: 'Biceps and forearms',
      equipment: 'Dumbbell',
      cue: '',
      aliases: [],
      loadStepKg: 2
    },
    {
      id: 'ex-3',
      slug: 'squat',
      name: 'Barbell Back Squat',
      muscle: 'Quads',
      equipment: 'Barbell',
      cue: '',
      aliases: [],
      loadStepKg: 2.5
    }
  ];

  it('resolves muscles from matched catalog id', () => {
    const items = [{ exerciseId: 'ex-1' }, { exerciseId: 'ex-2' }];
    const muscles = getWorkoutMuscles(items, catalog);
    expect(muscles).toContain('Chest');
    expect(muscles).toContain('Biceps');
    expect(muscles).toContain('Forearms');
  });

  it('resolves muscles from name or alias when unlinked', () => {
    const items = [{ sourceName: 'Bench Press' }, { name: 'Barbell Back Squat' }];
    const muscles = getWorkoutMuscles(items, catalog);
    expect(muscles).toContain('Chest');
    expect(muscles).toContain('Quads');
  });

  it('infers muscles from keyword heuristics when not in catalog', () => {
    const items = [
      { sourceName: 'Incline DB Y-Raise' },
      { sourceName: 'Lying Leg Curl' },
      { sourceName: 'Dragon Flag' }
    ];
    const muscles = getWorkoutMuscles(items, catalog);
    expect(muscles).toContain('Shoulders');
    expect(muscles).toContain('Hamstrings');
    expect(muscles).toContain('Core');
  });

  it('resolves Traps directly and refines shrug movements from compound buckets', () => {
    const trapCatalog: Exercise[] = [
      { id: 'ex-4', slug: 'dumbbell-shrug', name: 'Dumbbell Shrug', muscle: 'Traps', equipment: 'Dumbbell', cue: '', aliases: [], loadStepKg: 2 },
      { id: 'ex-5', slug: 'kelso-shrug', name: 'Kelso Shrug', muscle: 'Traps, calves, and hips', equipment: 'Dumbbell', cue: '', aliases: [], loadStepKg: 2 },
      { id: 'ex-6', slug: 'standing-calf-raise', name: 'Standing Calf Raise', muscle: 'Traps, calves, and hips', equipment: 'Machine', cue: '', aliases: [], loadStepKg: 5 }
    ];
    const items = [{ exerciseId: 'ex-4' }, { exerciseId: 'ex-5' }, { exerciseId: 'ex-6' }, { sourceName: 'Barbell Shrug' }];
    const muscles = getWorkoutMuscles(items, trapCatalog);
    expect(muscles).toContain('Traps');
    expect(muscles).toContain('Calves');
  });

  it('returns empty array when no items provided', () => {
    expect(getWorkoutMuscles([], catalog)).toEqual([]);
  });
});
