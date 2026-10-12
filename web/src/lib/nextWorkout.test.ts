import { describe, expect, it } from 'vitest';
import type { NextWorkoutSummary } from '../types';
import { nextWorkout } from './nextWorkout';
import { mockBootstrap, mockProgram, mockProgramDay, mockTemplate } from '../components/nextWorkoutHeroTestFixtures';

describe('nextWorkout', () => {
  it('returns server-provided nextWorkout summary when present', () => {
    const serverSummary: NextWorkoutSummary = {
      id: 't-server',
      name: 'Server Workout',
      focus: 'Full Body',
      week: 1,
      position: 0,
      exerciseCount: 3
    };
    const result = nextWorkout(mockBootstrap({ nextWorkout: serverSummary }));
    expect(result).toEqual(serverSummary);
  });

  it('honors explicit server nextWorkout: null without falling back to library templates', () => {
    const t1 = mockTemplate({ id: 't-1', programId: null, name: 'Library Workout' });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: null,
      templates: [t1]
    }));
    expect(result).toBeNull();
  });

  it('prefers active program next day over templates when nextWorkout is undefined', () => {
    const day1 = mockProgramDay({ id: 'd-1', name: 'Upper A' });
    const day2 = mockProgramDay({ id: 'd-2', name: 'Lower A' });
    const prog = mockProgram({
      days: [day1, day2],
      nextTemplateId: 'd-2'
    });
    const t1 = mockTemplate({ id: 't-1', programId: null, active: true });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      activeProgram: prog,
      templates: [t1]
    }));
    expect(result).toEqual(day2);
  });

  it('returns null when active program has no nextTemplateId and nextWorkout is undefined', () => {
    const prog = mockProgram({ nextTemplateId: null });
    const t1 = mockTemplate({ id: 't-1', programId: null });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      activeProgram: prog,
      templates: [t1]
    }));
    expect(result).toBeNull();
  });

  it('selects non-first active pending standalone template ahead of earlier library templates', () => {
    const t1 = mockTemplate({ id: 't-1', programId: null, name: 'First Inactive', position: 0, active: false });
    const t2 = mockTemplate({ id: 't-2', programId: null, name: 'Second Active', position: 1, active: true, activeCompletedAt: null });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      templates: [t1, t2]
    }));
    expect(result).toEqual(t2);
  });

  it('returns null when active standalone is completed, suppressing library fallback', () => {
    const t1 = mockTemplate({ id: 't-1', programId: null, name: 'First Inactive', position: 0, active: false });
    const t2 = mockTemplate({ id: 't-2', programId: null, name: 'Second Active Finished', position: 1, active: true, activeCompletedAt: '2026-10-11T12:00:00Z' });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      templates: [t1, t2]
    }));
    expect(result).toBeNull();
  });

  it('returns standalone again when restarted (activeCompletedAt cleared)', () => {
    const t1 = mockTemplate({ id: 't-1', programId: null, name: 'First Inactive', position: 0, active: false });
    const t2 = mockTemplate({ id: 't-2', programId: null, name: 'Second Active Restarted', position: 1, active: true, activeCompletedAt: null });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      templates: [t1, t2]
    }));
    expect(result).toEqual(t2);
  });

  it('falls back to first library template when standalone is moved to library', () => {
    const t1 = mockTemplate({ id: 't-1', programId: null, name: 'First Inactive', position: 0, active: false });
    const t2 = mockTemplate({ id: 't-2', programId: null, name: 'Second Moved Back', position: 1, active: false, activeCompletedAt: null });
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      templates: [t1, t2]
    }));
    expect(result).toEqual(t1);
  });

  it('returns null when templates list is empty and no active program exists', () => {
    const result = nextWorkout(mockBootstrap({
      nextWorkout: undefined,
      templates: []
    }));
    expect(result).toBeNull();
  });
});
