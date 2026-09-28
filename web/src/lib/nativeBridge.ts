// Capacitor plugin calls for the Android app. This module is only ever loaded with a dynamic
// import from lib/platform.ts after isNative() is true, so the web bundle never carries it.
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { registerPlugin } from '@capacitor/core';
import type { Haptic } from './platform';

// Kept apart from the ongoing workout notification so a legacy alert never replaces it.
const LEGACY_REST_NOTIFICATION_ID = 7201;

export interface AlertCapabilities {
  exactAlarm: boolean;
  notifications: boolean;
  batteryExempt: boolean;
  liveUpdates: boolean;
  serviceError: string | null;
}

/// The workout state the Android service shows and alerts from. It is one snapshot rather than a
/// series of commands, so a late or repeated call can only restate the latest intent.
export type NativeWorkoutState = {
  sessionId: string;
  generation: string;
  status: 'running' | 'paused' | 'idle';
  deadlineMs: number;
  pausedRemainingMs: number;
  startedAtMs: number | null;
  pausedAtMs: number | null;
  pausedSeconds: number;
  alert: boolean;
  sound: boolean;
  vibrate: boolean;
};

export interface WorkoutPluginInterface {
  getRecoveryRecord(options: { accountId: string }): Promise<{ recordJson?: string | null }>;
  saveRecoveryRecord(options: { accountId: string; sessionId: string; recordJson: string }): Promise<void>;
  deleteRecoveryRecord(options: { accountId: string }): Promise<void>;
  getLastAccountId(): Promise<{ accountId?: string | null }>;
  setLastAccountId(options: { accountId: string | null }): Promise<void>;
  claimRestAlert(options: { sessionId: string; generation: string }): Promise<{ claimed: boolean }>;
  syncWorkout(options: NativeWorkoutState & { epoch: string; sequence: number }): Promise<void>;
  stopWorkout(): Promise<void>;
  getAlertCapabilities(): Promise<AlertCapabilities>;
  openSettings(options: { type: 'exact_alarm' | 'notifications' | 'battery' | 'app' }): Promise<void>;
  testAlert(options: { sound: boolean; vibrate: boolean }): Promise<void>;
}

export const WorkoutNative = registerPlugin<WorkoutPluginInterface>('WorkoutPlugin');

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

// Each page load is a new epoch; within it, a higher sequence always wins at the service.
const epoch = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
let sequence = 0;

export async function nativeSyncWorkout(state: NativeWorkoutState): Promise<void> {
  await WorkoutNative.syncWorkout({ ...state, epoch, sequence: ++sequence });
}

export async function nativeStopWorkout(): Promise<void> {
  await WorkoutNative.stopWorkout();
}

/// Apps installed before the workout service keep the scheduled local notification.
export async function nativeScheduleLegacyRest(at: number, sessionId: string | null) {
  await LocalNotifications.cancel({ notifications: [{ id: LEGACY_REST_NOTIFICATION_ID }] });
  await LocalNotifications.schedule({
    notifications: [{
      id: LEGACY_REST_NOTIFICATION_ID,
      title: 'Rest timer',
      body: 'Your rest is over.',
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: sessionId ? { url: `/?workout=${encodeURIComponent(sessionId)}` } : undefined
    }]
  });
}

export async function nativeCancelLegacyRest() {
  await LocalNotifications.cancel({ notifications: [{ id: LEGACY_REST_NOTIFICATION_ID }] });
}

export async function nativeGetRecovery(accountId: string): Promise<string | null> {
  const result = await WorkoutNative.getRecoveryRecord({ accountId });
  return result.recordJson ?? null;
}

export async function nativeSaveRecovery(accountId: string, sessionId: string, recordJson: string): Promise<void> {
  await WorkoutNative.saveRecoveryRecord({ accountId, sessionId, recordJson });
}

export async function nativeDeleteRecovery(accountId: string): Promise<void> {
  await WorkoutNative.deleteRecoveryRecord({ accountId });
}

export async function nativeGetLastAccountId(): Promise<string | null> {
  const result = await WorkoutNative.getLastAccountId();
  return result.accountId ?? null;
}

export async function nativeSetLastAccountId(accountId: string | null): Promise<void> {
  await WorkoutNative.setLastAccountId({ accountId });
}

export async function nativeClaimRestAlert(sessionId: string, generation: string): Promise<boolean> {
  const result = await WorkoutNative.claimRestAlert({ sessionId, generation });
  return result.claimed;
}

export async function nativeGetAlertCapabilities(): Promise<AlertCapabilities> {
  return WorkoutNative.getAlertCapabilities();
}

export async function nativeOpenSettings(type: 'exact_alarm' | 'notifications' | 'battery' | 'app'): Promise<void> {
  await WorkoutNative.openSettings({ type });
}

export async function nativeTestAlert(sound: boolean, vibrate: boolean): Promise<void> {
  await WorkoutNative.testAlert({ sound, vibrate });
}

// Android's back button walks the same history the web app keeps (lib/backStack.ts): the top
// sheet first, then earlier tabs, and at the first screen it leaves the app. Tapping the rest
// notification opens the workout it belongs to.
let shellInstalled = false;

export async function installNativeShell() {
  if (shellInstalled) return;
  shellInstalled = true;
  await App.addListener('resume', () => window.dispatchEvent(new Event('workout:resume')));
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
