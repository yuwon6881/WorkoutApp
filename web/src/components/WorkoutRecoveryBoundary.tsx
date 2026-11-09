import { useSyncExternalStore } from 'react';
import { Workout as WorkoutLogger, type WorkoutProps } from './Workout';
import type { RecoveryStore } from '../lib/recoveryStore';

const noSubscription = () => () => {};

export function Workout({ recoveryStore, ...props }: WorkoutProps & { recoveryStore?: RecoveryStore }) {
  const record = useSyncExternalStore(recoveryStore?.subscribe ?? noSubscription,
    recoveryStore?.getSnapshot ?? (() => props.recovery));
  const recovery = record?.accountId === props.accountId && record.sessionId === props.session.id ? record : null;
  return <WorkoutLogger {...props} recovery={recovery} />;
}
