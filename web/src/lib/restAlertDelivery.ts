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

/// Asks for notification permission at most once, as soon as the signed-in Android app opens with
/// rest alerts on, so a fresh install is ready before its first rest instead of prompting mid-set.
/// Android reports a permission it has never asked about as `default`; once answered either way
/// it is never asked again here, and changing it is left to Settings.
export async function askRestAlertPermissionAtLaunch(
  restAlerts: boolean,
  permission: (request: boolean) => Promise<NotificationPermission>
): Promise<boolean> {
  if (!restAlerts || await permission(false) !== 'default') return false;
  await permission(true);
  return true;
}
