import { useEffect, useState } from 'react';
import type { RestAction, RestMutationInput, Session, SessionRest } from '../types';
import { restTimer, type RestState } from '../lib/restTimer';
import { enqueueRest, type WorkoutRecoveryRecord } from '../lib/workoutRecovery';

export function useWorkoutRest({
  accountId,
  draft,
  revision,
  paused,
  finishIntentAt,
  recoveryConflict,
  recovery,
  defaultRestSeconds,
  onRecoveryChange,
  onError
}: {
  accountId: string;
  draft: Session;
  revision: { current: number };
  paused: boolean;
  finishIntentAt: string | null;
  recoveryConflict: boolean;
  recovery: WorkoutRecoveryRecord | null;
  defaultRestSeconds: number;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  onError: (message: string) => void;
}) {
  const [rest, setRest] = useState<RestState>(restTimer.current);

  useEffect(() => {
    restTimer.setWorkoutVisible(true);
    const unsubscribe = restTimer.subscribe(setRest);
    return () => {
      unsubscribe();
      restTimer.setWorkoutVisible(false);
    };
  }, []);

  async function handleRestMutate(action: RestAction, seconds?: number) {
    if (paused || finishIntentAt || recoveryConflict) return;
    const gen = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    let mutation: RestMutationInput;
    let nextRestState: SessionRest | null = null;

    if (action === 'start') {
      const s = seconds ?? defaultRestSeconds;
      restTimer.primeSound();
      restTimer.start(s, gen);
      const deadlineUtc = new Date(Date.now() + s * 1000).toISOString();
      mutation = { revision: revision.current, action: 'start', seconds: s, generation: gen, occurredAt };
      nextRestState = {
        generation: gen,
        status: 'running',
        deadlineUtc,
        pausedRemainingMs: null,
        durationMs: s * 1000,
        originDeviceId: null
      };
    } else if (action === 'extend' || action === 'shorten') {
      const s = seconds ?? 15;
      if (action === 'extend') {
        restTimer.primeSound();
        restTimer.extend(s, gen);
      } else {
        restTimer.shorten(s, gen);
      }
      mutation = { revision: revision.current, action, seconds: s, generation: gen, occurredAt };
      const current = restTimer.current;
      const isResting = current.endsAt > Date.now() || current.pausedRemainingMs > 0;
      nextRestState = isResting ? {
        generation: current.generation,
        status: current.endsAt === 0 ? 'paused' : 'running',
        deadlineUtc: current.endsAt > 0 ? new Date(current.endsAt).toISOString() : null,
        pausedRemainingMs: current.pausedRemainingMs > 0 ? current.pausedRemainingMs : null,
        durationMs: current.totalSeconds * 1000,
        originDeviceId: null
      } : null;
    } else if (action === 'skip') {
      restTimer.skip();
      mutation = { revision: revision.current, action: 'skip', generation: gen, occurredAt };
      nextRestState = null;
    } else {
      return;
    }

    if (recovery) {
      try {
        const record = await enqueueRest(accountId, draft.id, mutation, draft, nextRestState);
        onRecoveryChange(record);
      } catch (failure) {
        // The timer on this device keeps running, but other devices will not see this change.
        onError(failure instanceof Error ? failure.message : 'This rest change could not be saved on the device.');
      }
    }
  }

  return { rest, handleRestMutate };
}
