import type {CardFeedbackTone} from '../components/ui/CardFeedback';
import type {GoogleHealthWorkoutSyncStatus} from './googleHealth';

export type UploadFailureAction = 'retry' | 'reconnect';

export interface UploadFailureView {
  tone: CardFeedbackTone;
  title: string;
  message: string;
  /** The server's own wording, kept behind a disclosure for support and diagnosis. */
  detail?: string;
  action: UploadFailureAction;
  actionLabel: string;
}

const RECONNECT_CODES = new Set(['reconnect_required', 'permission_missing']);
const TEMPORARY_CODES = new Set(['rate_limit_exceeded', 'provider_unavailable', 'provider_error']);

/** Describes a failed or uncertain workout upload, or null when nothing needs attention. */
export function describeWorkoutUploadFailure(
  sync: Pick<GoogleHealthWorkoutSyncStatus, 'state' | 'failureCode' | 'failureMessage'>,
): UploadFailureView | null {
  const detail = sync.failureMessage?.trim() || undefined;

  if (sync.state === 'unknown') {
    return {
      tone: 'warning',
      title: 'Upload may have gone through',
      message: 'Google Health did not confirm a workout upload. Check Google Health for the workout first: retrying can add a second copy.',
      detail,
      action: 'retry',
      actionLabel: 'Retry anyway',
    };
  }
  if (sync.state !== 'failed') return null;

  if (sync.failureCode && RECONNECT_CODES.has(sync.failureCode)) {
    return {
      tone: 'error',
      title: 'Google Health needs your permission',
      message: 'Workouts cannot upload until Google Health is reconnected with workout access. Your workouts stay saved here.',
      detail,
      action: 'reconnect',
      actionLabel: 'Reconnect',
    };
  }
  if (sync.failureCode && TEMPORARY_CODES.has(sync.failureCode)) {
    return {
      tone: 'warning',
      title: 'Google Health is not responding',
      message: 'The workout upload was paused by Google Health. Your workouts stay saved here; try again in a few minutes.',
      detail,
      action: 'retry',
      actionLabel: 'Try again',
    };
  }
  if (sync.failureCode === 'provider_validation') {
    return {
      tone: 'error',
      title: 'Google Health did not accept a workout',
      message: 'The workout is saved here and is not lost. Retry sends it again; if it keeps failing, share the detail below with support.',
      detail,
      action: 'retry',
      actionLabel: 'Retry upload',
    };
  }
  return {
    tone: 'error',
    title: 'Workout upload failed',
    message: 'The workout is saved here but did not reach Google Health. Retry to send it again.',
    detail,
    action: 'retry',
    actionLabel: 'Retry upload',
  };
}
