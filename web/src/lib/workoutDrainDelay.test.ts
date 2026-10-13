import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import type { WorkoutOperation, WorkoutRecoveryRecord } from './workoutRecovery';
import { EDIT_DRAIN_MS, PROMPT_DRAIN_MS, workoutDrainDelay } from './workoutDrainDelay';

const baseSession: Session = {
  id: 'workout-1',
  templateId: null,
  programId: null,
  name: 'Push Day',
  note: '',
  active: true,
  startedAt: '2026-09-21T08:00:00.000Z',
  finishedAt: null,
  pausedAt: null,
  pausedSeconds: 0,
  revision: 12,
  exercises: [
    {
      id: 'session-ex-1',
      exerciseId: 'ex-bench',
      name: 'Bench Press',
      position: 0,
      note: 'Keep shoulder blades retracted',
      prescription: [],
      sequenceGroup: '',
      substitutions: [],
      progression: null,
      sets: [
        { id: 'set-1', position: 0, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false },
        { id: 'set-2', position: 1, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false }
      ]
    }
  ],
  volumeKg: null,
  completedSets: 0,
  warmupSets: 0
};

function createRecord(
  operations: WorkoutOperation[],
  serverOverrides: Partial<Session> = {},
  draftOverrides: Partial<Session> = {}
): WorkoutRecoveryRecord {
  const serverSession: Session = { ...baseSession, ...serverOverrides };
  const draft: Session = { ...serverSession, ...draftOverrides };
  return {
    schemaVersion: 1,
    accountId: 'account-1',
    displayName: 'Lifter',
    sessionId: serverSession.id,
    draft,
    serverSession,
    preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
    activeIndex: 0,
    operations,
    conflict: false,
    updatedAt: '2026-09-21T08:05:00.000Z'
  };
}

describe('workoutDrainDelay', () => {
  it('returns EDIT_DRAIN_MS for a value-only setPatch', () => {
    const record = createRecord([
      {
        id: 'op-1',
        type: 'setPatch',
        setId: 'set-1',
        patch: { weightKg: 85, reps: 10 },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(record)).toBe(EDIT_DRAIN_MS);
  });

  it('returns PROMPT_DRAIN_MS for a setPatch toggling done', () => {
    const markDoneRecord = createRecord([
      {
        id: 'op-1',
        type: 'setPatch',
        setId: 'set-1',
        patch: { done: true },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(markDoneRecord)).toBe(PROMPT_DRAIN_MS);

    const serverWithDone: Session = {
      ...baseSession,
      exercises: [
        {
          ...baseSession.exercises[0],
          sets: [
            { ...baseSession.exercises[0].sets[0], done: true },
            baseSession.exercises[0].sets[1]
          ]
        }
      ]
    };
    const unmarkDoneRecord = createRecord(
      [
        {
          id: 'op-2',
          type: 'setPatch',
          setId: 'set-1',
          patch: { done: false },
          revision: null,
          createdAt: '2026-09-21T08:01:00.000Z'
        }
      ],
      serverWithDone
    );
    expect(workoutDrainDelay(unmarkDoneRecord)).toBe(PROMPT_DRAIN_MS);

    const missingSetRecord = createRecord([
      {
        id: 'op-3',
        type: 'setPatch',
        setId: 'unknown-set',
        patch: { done: true },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(missingSetRecord)).toBe(PROMPT_DRAIN_MS);
  });

  it('returns PROMPT_DRAIN_MS for a setPatch with rest', () => {
    const record = createRecord([
      {
        id: 'op-1',
        type: 'setPatch',
        setId: 'set-1',
        patch: { weightKg: 85 },
        rest: { revision: 12, action: 'start', seconds: 90, generation: 'gen-1' },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(record)).toBe(PROMPT_DRAIN_MS);
  });

  it('returns PROMPT_DRAIN_MS for rest, pause, resume, and finish operations', () => {
    const restRecord = createRecord([
      {
        id: 'op-rest',
        type: 'rest',
        rest: { revision: 12, action: 'start', seconds: 60, generation: 'gen-1' },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(restRecord)).toBe(PROMPT_DRAIN_MS);

    const pauseRecord = createRecord([
      {
        id: 'op-pause',
        type: 'pause',
        occurredAt: '2026-09-21T08:02:00.000Z',
        revision: null,
        createdAt: '2026-09-21T08:02:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(pauseRecord)).toBe(PROMPT_DRAIN_MS);

    const resumeRecord = createRecord([
      {
        id: 'op-resume',
        type: 'resume',
        occurredAt: '2026-09-21T08:03:00.000Z',
        revision: null,
        createdAt: '2026-09-21T08:03:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(resumeRecord)).toBe(PROMPT_DRAIN_MS);

    const finishRecord = createRecord([
      {
        id: 'op-finish',
        type: 'finish',
        finishedAt: '2026-09-21T08:20:00.000Z',
        retainExerciseSwaps: false,
        revision: null,
        createdAt: '2026-09-21T08:20:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(finishRecord)).toBe(PROMPT_DRAIN_MS);
  });

  it('returns EDIT_DRAIN_MS for note-only saves', () => {
    const recordSessionNote = createRecord([
      {
        id: 'op-save-1',
        type: 'save',
        draft: { ...baseSession, note: 'Updated session note' },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(recordSessionNote)).toBe(EDIT_DRAIN_MS);

    const recordExerciseNote = createRecord([
      {
        id: 'op-save-2',
        type: 'save',
        draft: {
          ...baseSession,
          exercises: [{ ...baseSession.exercises[0], note: 'Squeeze at top' }]
        },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(recordExerciseNote)).toBe(EDIT_DRAIN_MS);
  });

  it('returns PROMPT_DRAIN_MS for a save adding a set', () => {
    const recordAddSet = createRecord([
      {
        id: 'op-save-add-set',
        type: 'save',
        draft: {
          ...baseSession,
          exercises: [
            {
              ...baseSession.exercises[0],
              sets: [
                ...baseSession.exercises[0].sets,
                { id: 'set-3', position: 2, weightKg: 80, reps: 8, rpe: null, done: false, warmup: false }
              ]
            }
          ]
        },
        revision: null,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(recordAddSet)).toBe(PROMPT_DRAIN_MS);
  });

  it('ignores bound operations when calculating delay', () => {
    const record = createRecord([
      {
        id: 'op-bound-finish',
        type: 'finish',
        finishedAt: '2026-09-21T08:20:00.000Z',
        retainExerciseSwaps: false,
        revision: 12,
        createdAt: '2026-09-21T08:20:00.000Z'
      },
      {
        id: 'op-unbound-value',
        type: 'setPatch',
        setId: 'set-1',
        patch: { weightKg: 85 },
        revision: null,
        createdAt: '2026-09-21T08:21:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(record)).toBe(EDIT_DRAIN_MS);
  });

  it('returns PROMPT_DRAIN_MS when unbound operations are empty', () => {
    const allBoundRecord = createRecord([
      {
        id: 'op-bound-1',
        type: 'setPatch',
        setId: 'set-1',
        patch: { weightKg: 85 },
        revision: 12,
        createdAt: '2026-09-21T08:01:00.000Z'
      }
    ]);
    expect(workoutDrainDelay(allBoundRecord)).toBe(PROMPT_DRAIN_MS);

    const emptyRecord = createRecord([]);
    expect(workoutDrainDelay(emptyRecord)).toBe(PROMPT_DRAIN_MS);
  });
});
