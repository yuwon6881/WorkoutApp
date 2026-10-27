import { describe, expect, it } from 'vitest';
import { recommendedWarmupCount, warmupSteps, type WarmupContext } from './warmupPlan';

const context = (overrides: Partial<WarmupContext> = {}): WarmupContext => ({
  workingKg: 100, equipment: 'Barbell', muscle: 'Quads', perSide: false, entry: 'external',
  bodyweightKg: 80, unit: 'kg', grid: { stepKg: 2.5, availableLoadsKg: null }, ...overrides
});

describe('recommendedWarmupCount', () => {
  it('ramps heavier barbell lifts more than light ones', () => {
    expect(recommendedWarmupCount(context({ workingKg: 140 }))).toBe(4);
    expect(recommendedWarmupCount(context({ workingKg: 70 }))).toBe(3);
    expect(recommendedWarmupCount(context({ workingKg: 40 }))).toBe(2);
  });

  it('gives machines, dumbbells and small muscles fewer', () => {
    expect(recommendedWarmupCount(context({ equipment: 'Machine', workingKg: 120 }))).toBe(2);
    expect(recommendedWarmupCount(context({ equipment: 'Machine', workingKg: 50 }))).toBe(1);
    expect(recommendedWarmupCount(context({ equipment: 'Dumbbell', perSide: true, workingKg: 24 }))).toBe(2);
    expect(recommendedWarmupCount(context({ equipment: 'Barbell', muscle: 'Biceps and forearms', workingKg: 40 }))).toBe(1);
    expect(recommendedWarmupCount(context({ equipment: 'Cable', workingKg: 30 }))).toBe(1);
  });

  it('offers none for reps-only or assisted movements', () => {
    expect(recommendedWarmupCount(context({ entry: 'none' }))).toBe(0);
    expect(recommendedWarmupCount(context({ entry: 'assistance' }))).toBe(0);
  });

  it('reads heaviness from fixed loads without a bodyweight', () => {
    expect(recommendedWarmupCount(context({ bodyweightKg: null, workingKg: 100 }))).toBe(4);
  });
});

describe('warmupSteps', () => {
  it('opens a barbell ramp with the empty bar and climbs below the working load', () => {
    expect(warmupSteps(context({ workingKg: 140 }), 4)).toEqual([
      { weightKg: 40, reps: 10 }, { weightKg: 70, reps: 5 }, { weightKg: 97.5, reps: 3 }, { weightKg: 117.5, reps: 1 }
    ]);
    expect(warmupSteps(context({ workingKg: 60 }), 3)[0]).toEqual({ weightKg: 20, reps: 8 });
  });

  it('keeps a lone warm-up at its share of the working load rather than the empty bar', () => {
    expect(warmupSteps(context({ workingKg: 60 }), 1)).toEqual([{ weightKg: 35, reps: 8 }]);
  });

  it('collapses steps that round onto the same load, never reaching the working load', () => {
    const steps = warmupSteps(context({ workingKg: 30 }), 3);
    expect(steps.map(step => step.weightKg)).toEqual([20, 22.5]);
  });

  it('uses the listed weights of a machine or dumbbell rack', () => {
    const steps = warmupSteps(context({ equipment: 'Dumbbell', perSide: true, workingKg: 30,
      grid: { stepKg: 2, availableLoadsKg: [10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30] } }), 2);
    expect(steps).toEqual([{ weightKg: 15, reps: 8 }, { weightKg: 22.5, reps: 4 }]);
  });

  it('starts a weighted bodyweight movement from bodyweight alone', () => {
    const steps = warmupSteps(context({ entry: 'added', equipment: 'Bodyweight', workingKg: 20 }), 2);
    expect(steps).toEqual([{ weightKg: 0, reps: 8 }, { weightKg: 15, reps: 4 }]);
  });
});
