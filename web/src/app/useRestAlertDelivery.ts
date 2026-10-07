import { useEffect, useState } from 'react';
import { getAlertCapabilities, hasNativeWorkoutStore, notificationPermission } from '../lib/platform';
import { REST_ALERTS_CHANGED_EVENT, restAlertsDeliverable } from '../lib/restAlertDelivery';

/// Whether rest alerts should go through the Android notification channel. The account setting
/// alone is not enough: on a fresh install notification permission has never been asked, and a
/// channel that cannot post would leave every rest silent. The permission is asked once a
/// workout is under way, when a rest alert is about to matter.
export function useRestAlertDelivery(restAlerts: boolean, sessionId: string | null): boolean {
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
    if (!native || !restAlerts || !sessionId) return;
    let active = true;
    void (async () => {
      if (await notificationPermission(false) !== 'default' || !active) return;
      await notificationPermission(true);
      if (active) window.dispatchEvent(new Event(REST_ALERTS_CHANGED_EVENT));
    })();
    return () => { active = false; };
  }, [native, restAlerts, sessionId]);

  return native ? restAlertsDeliverable(restAlerts, channelAllowed) : restAlerts;
}
