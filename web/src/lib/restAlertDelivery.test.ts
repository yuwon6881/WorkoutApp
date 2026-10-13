import { describe, expect, it } from 'vitest';
import { restAlertCancelNeeded, restAlertPushKey, restAlertsDeliverable } from './restAlertDelivery';

describe('rest alert delivery', () => {
  it('keeps the page chime when the Android channel cannot post', () => {
    // A fresh install has never been asked for notification permission.
    expect(restAlertsDeliverable(true, false)).toBe(false);
  });

  it('uses the notification channel once it can post, and keeps the setting while unknown', () => {
    expect(restAlertsDeliverable(true, true)).toBe(true);
    expect(restAlertsDeliverable(true, null)).toBe(true);
    expect(restAlertsDeliverable(false, true)).toBe(false);
  });
});

describe('rest alert push cancellation', () => {
  const target = { accountId: 'a', sessionId: 's', generation: 'g' };

  it('skips the cancel only when no schedule request was ever sent for that rest', () => {
    expect(restAlertCancelNeeded(target, { key: restAlertPushKey(target), inFlight: false, confirmed: false, unscheduled: true })).toBe(false);
  });

  it('still cancels a confirmed, in-flight, failed, or different rest', () => {
    const key = restAlertPushKey(target);
    expect(restAlertCancelNeeded(target, { key, inFlight: false, confirmed: true })).toBe(true);
    expect(restAlertCancelNeeded(target, { key, inFlight: true, confirmed: false })).toBe(true);
    expect(restAlertCancelNeeded(target, { key, inFlight: false, confirmed: false })).toBe(true);
    expect(restAlertCancelNeeded(target, { key: 'a:s:other', inFlight: false, confirmed: false, unscheduled: true })).toBe(true);
    expect(restAlertCancelNeeded(target, null)).toBe(true);
  });
});
