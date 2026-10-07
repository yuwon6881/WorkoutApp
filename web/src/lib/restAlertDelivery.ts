/// Rest alerts reach the Android notification channel only while that channel can post. When it
/// cannot (permission never granted, or the channel switched off), the page keeps the chime and
/// vibration itself so a finished rest is never silent. An unknown channel state keeps the
/// account setting until the phone answers.
export function restAlertsDeliverable(restAlerts: boolean, channelAllowed: boolean | null): boolean {
  return restAlerts && channelAllowed !== false;
}

/// Fired after the app asks for notification permission, so the delivery choice re-reads it.
export const REST_ALERTS_CHANGED_EVENT = 'workout-rest-alerts-changed';
