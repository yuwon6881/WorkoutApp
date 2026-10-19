import { describe, expect, it, vi } from 'vitest';
import { askRestAlertPermissionAtLaunch, restAlertCancelNeeded, restAlertPushKey, restAlertsDeliverable } from './restAlertDelivery';

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

describe('notification permission at launch', () => {
  it('asks a fresh install once, before any workout starts', async () => {
    const permission = vi.fn(async (request: boolean): Promise<NotificationPermission> => request ? 'granted' : 'default');

    expect(await askRestAlertPermissionAtLaunch(true, permission)).toBe(true);
    expect(permission.mock.calls).toEqual([[false], [true]]);
  });

  it('never asks again once answered, or when rest alerts are off', async () => {
    for (const answered of ['granted', 'denied'] as const) {
      const permission = vi.fn(async (): Promise<NotificationPermission> => answered);
      expect(await askRestAlertPermissionAtLaunch(true, permission)).toBe(false);
      expect(permission).not.toHaveBeenCalledWith(true);
    }
    const off = vi.fn(async (): Promise<NotificationPermission> => 'default');
    expect(await askRestAlertPermissionAtLaunch(false, off)).toBe(false);
    expect(off).not.toHaveBeenCalled();
  });
});
