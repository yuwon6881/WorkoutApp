/// Rest alerts reach the Android notification channel only while that channel can post. When it
/// cannot (permission never granted, or the channel switched off), the page keeps the chime and
/// vibration itself so a finished rest is never silent. An unknown channel state keeps the
/// account setting until the phone answers.
export function restAlertsDeliverable(restAlerts: boolean, channelAllowed: boolean | null): boolean {
  return restAlerts && channelAllowed !== false;
}

/// Fired after the app asks for notification permission, so the delivery choice re-reads it.
export const REST_ALERTS_CHANGED_EVENT = 'workout-rest-alerts-changed';

export type RestAlertPushTarget = { accountId: string; sessionId: string; generation: string };
export type RestAlertPushAttempt = { key: string; inFlight: boolean; confirmed: boolean; unscheduled?: boolean };

export function restAlertPushKey(target: RestAlertPushTarget): string {
  return `${target.accountId}:${target.sessionId}:${target.generation}`;
}

/// A rest whose status check stopped before any schedule request has nothing on the server to
/// cancel. Any other outcome (sent, in flight, failed, or declined after a row was written) may
/// have left a schedule behind, so it is still cancelled.
export function restAlertCancelNeeded(previous: RestAlertPushTarget, attempt: RestAlertPushAttempt | null): boolean {
  return !(attempt?.unscheduled === true && attempt.key === restAlertPushKey(previous));
}
