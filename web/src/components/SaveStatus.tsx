import { AlertTriangle, CheckCircle2, Cloud, Loader2, WifiOff } from 'lucide-react';

/// The header's save word and icon, shown only while a save is slow or has a problem.
export function SaveStatus({ state, online }: { state: string; online: boolean }) {
  return <><StatusIcon state={state} online={online} /> {statusTitle(state, online)}</>;
}

function StatusIcon({ state, online }: { state: string; online: boolean }) {
  if (!online || state === 'offline') return <WifiOff size={14} />;
  if (state === 'saving' || state === 'connecting') return <Loader2 size={14} className="spin" />;
  if (state === 'failed' || state === 'signed-out') return <AlertTriangle size={14} />;
  if (state === 'saved') return <CheckCircle2 size={14} />;
  return <Cloud size={14} />;
}

function statusTitle(state: string, online: boolean): string {
  if (!online) return 'Offline';
  return { connecting: 'Connecting', saving: 'Saving…', saved: 'Saved', failed: 'Not saved', 'signed-out': 'Signed out' }[state] ?? '';
}
