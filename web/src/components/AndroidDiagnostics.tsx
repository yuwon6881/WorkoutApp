import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './AndroidDiagnostics.css';
import { getAlertCapabilities, isNative } from '../lib/platform';
import { getRecovery } from '../lib/workoutRecovery';
import { copyableDiagnostics, diagnosticLines, diagnosticTimestamp, recordedSync, type DiagnosticLine } from '../lib/deviceDiagnostics';
import { Button } from './ui/Button';
import { lastApkUpdate } from '../lib/apkUpdates';
import { CardFeedback } from './ui/CardFeedback';

export function AndroidDiagnostics({ accountId }: { accountId: string }) {
  const [lines, setLines] = useState<DiagnosticLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isNative()) return null;
  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { WorkoutNative } = await import('../lib/nativeBridge');
      const [info, recovery, alerts] = await Promise.all([
        WorkoutNative.getDeviceDiagnostics({ accountId }), getRecovery(accountId), getAlertCapabilities()
      ]);
      const yes = (value: boolean | undefined) => value === undefined ? 'Could not check' : value ? 'Enabled' : 'Disabled';
      setLines([...diagnosticLines(info, navigator.onLine, recordedSync(accountId)),
        ['Pending edits', String(recovery?.operations.length ?? 0)], ['Pending notification actions', String(info.pendingActions)],
        ['Rest alert readiness', !alerts ? 'Could not check' : !alerts.notifications || !alerts.restChannelEnabled ? 'Blocked' : alerts.restSoundEnabled ? 'Enabled' : 'Chime held by Do Not Disturb'],
        ['Exact alarms', yes(alerts?.exactAlarm)], ['Battery unrestricted', yes(alerts?.batteryExempt)],
        ['Workout service', alerts?.serviceError ? 'service_unavailable' : 'No failure reported'],
        ['Live Update promotion', yes(alerts?.liveUpdates)], ['Last update check', diagnosticTimestamp(lastApkUpdate().lastSuccessfulCheck ? new Date(lastApkUpdate().lastSuccessfulCheck!).toISOString() : null)]]);
    } catch { setMessage('Device diagnostics could not be checked. Try Refresh.'); }
    finally { setBusy(false); }
  };
  return <details className="android-diagnostics" onToggle={event => { if (event.currentTarget.open && !lines.length && !busy) void refresh(); }}>
    <summary><ChevronDown size={18} aria-hidden="true"/>Android diagnostics</summary>
    <dl>{lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {message && <CardFeedback tone={message === 'Diagnostics copied.' ? 'success' : 'warning'} title="Diagnostics" message={message}/>}
    <div className="actions">
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
      <Button variant="secondary" disabled={busy || !lines.length} onClick={() => {
        void navigator.clipboard.writeText(copyableDiagnostics(lines)).then(() => setMessage('Diagnostics copied.'), () => setMessage('The clipboard is unavailable.'));
      }}>Copy diagnostics</Button>
    </div>
  </details>;
}
