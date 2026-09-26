// Capacitor plugin calls for the Android app. This module is only ever loaded with a dynamic
// import from lib/platform.ts after isNative() is true, so the web bundle never carries it.
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { Haptic } from './platform';

// One notification id for the rest alert: a new rest replaces the previous one.
const REST_NOTIFICATION_ID = 7101;

export async function nativeHaptic(kind: Haptic) {
  if (kind === 'tick') await Haptics.selectionChanged();
  else if (kind === 'log') await Haptics.impact({ style: ImpactStyle.Medium });
  else if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
  else await Haptics.notification({ type: NotificationType.Warning });
}

export async function nativeKeepAwake(on: boolean) {
  if (on) await KeepAwake.keepAwake();
  else await KeepAwake.allowSleep();
}

export async function nativeNotificationPermission(request: boolean): Promise<NotificationPermission> {
  const status = request ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions();
  return status.display === 'granted' ? 'granted' : status.display === 'denied' ? 'denied' : 'default';
}

export async function nativeScheduleRest(at: number, sessionId: string | null) {
  await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  await LocalNotifications.schedule({
    notifications: [{
      id: REST_NOTIFICATION_ID,
      title: 'Rest timer',
      body: 'Your rest is over.',
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: sessionId ? { url: `/?workout=${encodeURIComponent(sessionId)}` } : undefined
    }]
  });
}

export async function nativeCancelRest() {
  await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
}

// Android's back button walks the same history the web app keeps (lib/backStack.ts): the top
// sheet first, then earlier tabs, and at the first screen it leaves the app. Tapping the rest
// notification opens the workout it belongs to.
let shellInstalled = false;

export async function installNativeShell() {
  if (shellInstalled) return;
  shellInstalled = true;
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', action => {
    const url = (action.notification.extra as { url?: string } | undefined)?.url;
    if (url) window.location.assign(url);
  });
}

export async function nativeStatusBar(theme: 'dark' | 'light', background: string) {
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
  await StatusBar.setBackgroundColor({ color: background });
}
