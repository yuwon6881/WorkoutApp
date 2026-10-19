import { useEffect, useState } from 'react';
import { getAlertCapabilities, hasNativeWorkoutStore, notificationPermission } from '../lib/platform';
import { askRestAlertPermissionAtLaunch, REST_ALERTS_CHANGED_EVENT, restAlertsDeliverable } from '../lib/restAlertDelivery';

/// Whether rest alerts should go through the Android notification channel. The account setting
/// alone is not enough: on a fresh install notification permission has never been asked, and a
/// channel that cannot post would leave every rest silent. The permission is asked when the
/// signed-in app first opens, so a fresh install is ready before its first rest.
export function useRestAlertDelivery(restAlerts: boolean): boolean {
  const [channelAllowed, setChannelAllowed] = useState<boolean | null>(null);
  const native = hasNativeWorkoutStore();

  useEffect(() => {
    if (!native) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void getAlertCapabilities().then(capabilities => {
        if (active && capabilities) setChannelAllowed(capabilities.restChannelEnabled ?? capabilities.notifications);
      });
    };
    refresh();
    // Settings can change outside the app; returning to it is when the answer may differ.
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(REST_ALERTS_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(REST_ALERTS_CHANGED_EVENT, refresh);
    };
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let active = true;
    void askRestAlertPermissionAtLaunch(restAlerts, notificationPermission).then(asked => {
      if (asked && active) window.dispatchEvent(new Event(REST_ALERTS_CHANGED_EVENT));
    });
    return () => { active = false; };
  }, [native, restAlerts]);

  return native ? restAlertsDeliverable(restAlerts, channelAllowed) : restAlerts;
}
