import {describe, expect, it} from 'vitest';
import {describeWorkoutUploadFailure} from './googleHealthFailure';

describe('describeWorkoutUploadFailure', () => {
  it('has nothing to say while uploads are healthy', () => {
    for (const state of ['disabled', 'idle', 'pending', 'reconnect_required'] as const) {
      expect(describeWorkoutUploadFailure({state})).toBeNull();
    }
  });

  it('explains a rejected workout and keeps the server wording as detail', () => {
    const view = describeWorkoutUploadFailure({
      state: 'failed',
      failureCode: 'provider_validation',
      failureMessage: 'Google Health rejected the workout: Invalid value at exercise.exercise_type',
    });
    expect(view).toMatchObject({tone: 'error', action: 'retry', actionLabel: 'Retry upload'});
    expect(view?.message).toContain('not lost');
    expect(view?.detail).toContain('exercise.exercise_type');
  });

  it('sends a permission problem to reconnect rather than retry', () => {
    for (const failureCode of ['reconnect_required', 'permission_missing']) {
      expect(describeWorkoutUploadFailure({state: 'failed', failureCode, failureMessage: null}))
        .toMatchObject({action: 'reconnect', actionLabel: 'Reconnect'});
    }
  });

  it('treats provider outages as temporary', () => {
    const view = describeWorkoutUploadFailure({state: 'failed', failureCode: 'provider_unavailable'});
    expect(view).toMatchObject({tone: 'warning', action: 'retry', actionLabel: 'Try again'});
  });

  it('warns that retrying an uncertain upload can duplicate the workout', () => {
    const view = describeWorkoutUploadFailure({state: 'unknown', failureCode: 'upload_status_unknown'});
    expect(view).toMatchObject({tone: 'warning', actionLabel: 'Retry anyway'});
    expect(view?.message).toContain('second copy');
  });

  it('omits detail when the server gave none', () => {
    expect(describeWorkoutUploadFailure({state: 'failed', failureMessage: '  '})?.detail).toBeUndefined();
  });
});
