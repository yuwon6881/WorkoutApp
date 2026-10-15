export type DeviceInfo = { version: string; build: number; channel: 'device-test' | 'release'; android: string; sdk: number;
  webview: string | null; recoveryError: string | null };
export type DiagnosticLine = readonly [label: string, value: string];
export { recordedSync } from './confirmedSync';
export function diagnosticTimestamp(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
}
export function diagnosticLines(info: DeviceInfo, online: boolean, lastSync: string | null): DiagnosticLine[] {
  return [['APK', `${info.version} (build ${info.build})`], ['Distribution', info.channel],
    ['Android', `${info.android} (API ${info.sdk})`], ['WebView', info.webview ?? 'Could not check'],
    ['Device connection', online ? 'Online' : 'Offline'], ['Last confirmed sync', diagnosticTimestamp(lastSync)],
    ['Recovery', info.recoveryError === 'renderer_terminated' || info.recoveryError === 'rest_action_save_failed' ? info.recoveryError : info.recoveryError ? 'unavailable' : 'None recorded']];
}
export function copyableDiagnostics(lines: DiagnosticLine[]): string {
  // Only locally constructed, whitelisted diagnostic rows reach the clipboard.
  const allowed = new Set(['APK', 'Distribution', 'Android', 'WebView', 'Device connection', 'Last confirmed sync', 'Recovery',
    'Pending edits', 'Pending notification actions', 'Rest alert readiness', 'Exact alarms', 'Battery unrestricted',
    'Workout service', 'Live Update promotion', 'Last update check', 'Reminder readiness', 'Outbox changes', 'Body drafts',
    'Photo drafts', 'Food basket drafts', 'Food scan drafts']);
  return lines.filter(([label]) => allowed.has(label)).map(([label, value]) => `${label}: ${value}`).join('\n');
}
