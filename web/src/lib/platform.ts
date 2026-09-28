// The one seam between the web app and the device it runs on. Inside the Android app (Capacitor)
// these calls reach native plugins through lib/nativeBridge.ts, loaded only there; in a browser
// they fall back to web APIs or do nothing. Feature code imports only this module.

import type { AlertCapabilities, NativeWorkoutState } from './nativeBridge';

export type { AlertCapabilities, NativeWorkoutState };

type CapacitorGlobal = { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean };

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return Boolean(capacitor()?.isNativePlatform?.());
}

/// The Android app loads this site from its origin, so a newer site can run inside an older app
/// that predates the native workout plugin. Such an app keeps browser storage.
export function hasNativeWorkoutStore(): boolean {
  return isNative() && Boolean(capacitor()?.isPluginAvailable?.('WorkoutPlugin'));
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

// Calls reach the service in the order they were made; the service also drops any that arrive
// out of order, so this chain only keeps the bridge from racing itself.
let nativeWork: Promise<void> = Promise.resolve();
let nativeError: string | null = null;

function queueNative(work: () => Promise<void>) {
  nativeWork = nativeWork.then(work, work).catch(failure => {
    nativeError = failure instanceof Error && failure.message ? failure.message : 'The workout service could not be updated.';
  });
}

/// The Android app shows and alerts the workout from one snapshot: elapsed time while training,
/// the countdown while resting, and the paused state. `null` ends the workout notification.
/// Apps installed before the workout service keep a scheduled local notification for the rest.
export function syncNativeWorkout(state: NativeWorkoutState | null) {
  if (!isNative()) return;
  if (!hasNativeWorkoutStore()) {
    const at = state?.status === 'running' && state.alert ? state.deadlineMs : null;
    void bridge()
      .then(native => at === null ? native.nativeCancelLegacyRest() : native.nativeScheduleLegacyRest(at, state!.sessionId))
      .catch(() => undefined);
    return;
  }
  queueNative(async () => {
    const native = await bridge();
    if (state) await native.nativeSyncWorkout(state);
    else await native.nativeStopWorkout();
    nativeError = null;
  });
}

/// One device alerts once per rest: whichever of the page and the service claims it first.
/// Without the service there is nothing else to claim against, so the page always may.
export async function claimNativeRestAlert(sessionId: string, generation: string): Promise<boolean> {
  if (!hasNativeWorkoutStore()) return true;
  try { return await (await bridge()).nativeClaimRestAlert(sessionId, generation); }
  catch { return true; }
}

export async function getAlertCapabilities(): Promise<AlertCapabilities | null> {
  if (!hasNativeWorkoutStore()) return null;
  try {
    const capabilities = await (await bridge()).nativeGetAlertCapabilities();
    return { ...capabilities, serviceError: capabilities.serviceError ?? nativeError };
  } catch (failure) {
    return { exactAlarm: false, notifications: false, batteryExempt: false, liveUpdates: false,
      serviceError: failure instanceof Error ? failure.message : 'Workout alert status is unavailable.' };
  }
}

export async function openNativeSettings(type: 'exact_alarm' | 'notifications' | 'battery' | 'app'): Promise<void> {
  if (!hasNativeWorkoutStore()) return;
  await (await bridge()).nativeOpenSettings(type);
}

/// Posts a real rest-complete alert shortly, without touching the workout's own rest.
export async function testNativeAlert(sound: boolean, vibrate: boolean): Promise<void> {
  if (!hasNativeWorkoutStore()) return;
  await (await bridge()).nativeTestAlert(sound, vibrate);
}

export function installNativeShell() {
  if (!isNative()) return;
  void bridge().then(native => native.installNativeShell()).catch(() => undefined);
}

export function setNativeStatusBar(theme: 'dark' | 'light', background: string) {
  if (!isNative()) return;
  void bridge().then(native => native.nativeStatusBar(theme, background)).catch(() => undefined);
}
