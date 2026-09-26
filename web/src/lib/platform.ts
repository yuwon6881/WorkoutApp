// The one seam between the web app and the device it runs on. Inside the Android app (Capacitor)
// these calls reach native plugins through lib/nativeBridge.ts, loaded only there; in a browser
// they fall back to web APIs or do nothing. Feature code imports only this module.

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNative(): boolean {
  const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

export function isStandalone(): boolean {
  if (isNative()) return true;
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const bridge = () => import('./nativeBridge');

export type Haptic = 'tick' | 'log' | 'success' | 'warning';

// Web vibration patterns are coarse, so each kind is short and distinct: a tick is barely there,
// a logged set is one firm pulse, success is a double pulse, a warning is a longer buzz.
const WEB_PATTERNS: Record<Haptic, number | number[]> = {
  tick: 8,
  log: 18,
  success: [18, 60, 28],
  warning: [40, 50, 40]
};

let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}

export function haptic(kind: Haptic) {
  if (!hapticsEnabled) return;
  if (isNative()) { void bridge().then(native => native.nativeHaptic(kind)).catch(() => undefined); return; }
  try { navigator.vibrate?.(WEB_PATTERNS[kind]); } catch { /* Vibration is optional feedback. */ }
}

/// Keeps the screen on inside the Android app, where the web wake-lock API is not guaranteed.
export async function nativeKeepAwake(on: boolean): Promise<void> {
  if (!isNative()) return;
  try { await (await bridge()).nativeKeepAwake(on); } catch { /* The screen may still sleep. */ }
}

/// Notification permission for rest alerts: the Android app uses local notifications, which
/// need no push service; a browser uses the Notification API.
export async function notificationPermission(request: boolean): Promise<NotificationPermission> {
  if (isNative()) {
    try { return await (await bridge()).nativeNotificationPermission(request); } catch { return 'denied'; }
  }
  if (typeof Notification === 'undefined') return 'denied';
  return request ? Notification.requestPermission() : Notification.permission;
}

/// In the Android app a rest alert is a local notification scheduled for the deadline, so it
/// arrives with the screen off or the app closed without depending on web push.
export function scheduleNativeRestAlert(at: number | null, sessionId: string | null) {
  if (!isNative()) return;
  void bridge()
    .then(native => (at === null ? native.nativeCancelRest() : native.nativeScheduleRest(at, sessionId)))
    .catch(() => undefined);
}

export function installNativeShell() {
  if (!isNative()) return;
  void bridge().then(native => native.installNativeShell()).catch(() => undefined);
}

export function setNativeStatusBar(theme: 'dark' | 'light', background: string) {
  if (!isNative()) return;
  void bridge().then(native => native.nativeStatusBar(theme, background)).catch(() => undefined);
}
