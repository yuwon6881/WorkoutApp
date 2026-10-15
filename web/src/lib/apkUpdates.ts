import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

export type ApkUpdate = { status: 'available' | 'up-to-date' | 'incompatible' | 'unavailable';
  versionName?: string; releaseUrl?: string; lastSuccessfulCheck: number | null };
const native = registerPlugin<{
  checkApkUpdate(options: { manual: boolean }): Promise<ApkUpdate>;
  openApkRelease(): Promise<void>;
}>('WorkoutPlugin');
let latest: ApkUpdate = { status: 'unavailable', lastSuccessfulCheck: null };
let flight: Promise<ApkUpdate> | null = null;
export const UPDATE_CHECKED = 'apk-update-checked';
export const lastApkUpdate = () => latest;
export function checkApkUpdate(manual = false): Promise<ApkUpdate> {
  if (flight) return flight;
  flight = native.checkApkUpdate({ manual }).catch((): ApkUpdate => ({
    status: 'unavailable', lastSuccessfulCheck: latest.lastSuccessfulCheck
  })).then(result => {
    latest = result;
    window.dispatchEvent(new Event(UPDATE_CHECKED));
    return result;
  }).finally(() => { flight = null; });
  return flight;
}
export async function openApkRelease() { await native.openApkRelease(); }
let installed = false;
export async function installApkUpdateChecks() {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;
  await App.addListener('resume', () => { void checkApkUpdate(); });
  void checkApkUpdate();
}
