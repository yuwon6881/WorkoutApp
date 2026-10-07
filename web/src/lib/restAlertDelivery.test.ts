import { describe, expect, it } from 'vitest';
import { restAlertsDeliverable } from './restAlertDelivery';

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
