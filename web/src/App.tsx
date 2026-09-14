import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Cloud, Dumbbell, LayoutDashboard, Library, Loader2, Plus, RefreshCw, Settings, WifiOff } from 'lucide-react';
import type { Session, Template } from './types';
import { ApiError, api } from './lib/api';
import { useApp } from './app/useApp';
import { Button } from './components/ui/Button';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Programs } from './components/Programs';
import { Workout } from './components/Workout';
import { HistoryView, SessionDetail } from './components/History';
import { SettingsView } from './components/Settings';
import { ExerciseLibrary } from './components/Exercises';
import { ImportReview } from './components/Import';
import { StartPreview } from './components/StartPreview';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'program', label: 'Workouts', icon: Dumbbell },
  { id: 'history', label: 'Progress', icon: Activity },
  { id: 'exercises', label: 'Exercises', icon: Library }
];

const TITLES: Record<string, string> = { overview: 'Overview', program: 'Workouts', history: 'Progress', exercises: 'Exercise library', settings: 'Settings', import: 'Import a program' };

export default function App() {
  const app = useApp();
  const { data, status, loading, signedOut, online } = app;
  const [tab, setTab] = useState('overview');
  const [training, setTraining] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  const [toast, setToast] = useState('');
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = data?.preferences.theme ?? 'dark'; }, [data?.preferences.theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  if (signedOut) return <Auth onSignedIn={() => { setTab('overview'); void app.reload(); }} />;

  if (loading && !data) return <div className="auth-screen"><div className="panel auth-card"><Loader2 className="spin" size={26} /><h1>Loading your training…</h1>
    <p className="muted">Your workouts live on the server, so this needs a connection.</p></div></div>;

  if (!data) return <div className="auth-screen"><div className="panel auth-card">
    <AlertTriangle size={26} /><h1>Could not reach the server</h1>
    <p className="muted">{app.error || 'Check your connection and try again. Nothing has been lost: your training is saved on the server.'}</p>
    <Button variant="primary" onClick={() => void app.reload()}><RefreshCw size={17} />Try again</Button>
  </div></div>;

  /// Opening a plan shows what it contains first. A session is only created on the server once
  /// the preview is confirmed, so backing out leaves nothing behind.
  async function start(templateId: string) {
    setActionError('');
    if (data!.activeWorkout) { setTraining(true); return; }
    try { setPreview(await api.getTemplate(templateId)); }
    catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'That workout plan is no longer available. Refresh to see the current list.'); }
  }

  async function confirmStart() {
    if (starting || !preview) return;
    setStarting(true); setActionError('');
    try {
      const session = await api.startWorkout(preview.id);
      app.setActiveWorkout(session);
      setPreview(null);
      setTraining(true);
    } catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'Could not start that workout.'); setPreview(null); }
    finally { setStarting(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" /><span>Workout</span></a>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{NAV.map(item => <Button key={item.id} variant="tertiary" className={`nav-item ${tab === item.id ? 'selected' : ''}`}
        aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>
        <item.icon size={19} /><span>{item.label}</span>{tab === item.id && <span className="nav-dot" />}</Button>)}</nav>
      <div className="sidebar-bottom">
        <div className="local-note"><StatusIcon state={status.state} online={online} /><div><strong>{statusTitle(status.state, online)}</strong><p>{statusDetail(status, online)}</p></div></div>
        <Button variant="tertiary" className={`nav-item ${tab === 'settings' ? 'selected' : ''}`} onClick={() => setTab('settings')}><Settings size={19} /> Settings</Button>
        <div className="profile"><span className="avatar">{data.account.username.slice(0, 2).toUpperCase()}</span>
          <span><strong>{data.account.username}</strong><small>Make every rep count</small></span></div>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{TITLES[tab]}</strong></div>
        <a className="brand mobile-brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" />Workout</a>
        <div className="topbar-actions">
          <span className="device-status" role="status"><StatusIcon state={status.state} online={online} /> {statusTitle(status.state, online)}</span>
          <Button variant="tertiary" className="settings-icon" aria-label="Settings" onClick={() => setTab('settings')}><Settings size={19} /></Button>
          <span className="avatar small">{data.account.username.slice(0, 2).toUpperCase()}</span>
        </div>
      </header>

      <main>
        {status.state === 'failed' && <div className="error-banner" role="alert">
          <AlertTriangle size={17} />{status.message || 'A change could not be saved.'}
          <Button variant="tertiary" onClick={() => void app.reload()}><RefreshCw size={15} />Refresh</Button>
        </div>}
        {!online && <div className="error-banner" role="alert"><WifiOff size={17} />You are offline. Workouts are saved on the server, so logging is paused until the connection returns.</div>}
        {actionError && <div className="error-banner" role="alert">{actionError}</div>}

        {tab === 'overview' && <Dashboard data={data} onStart={start} onHistory={() => setTab('history')} onProgram={() => setTab('program')}
          onImport={() => setTab('import')} onSession={setDetail} onResume={() => setTraining(true)} />}
        {tab === 'program' && <Programs data={data} exercises={data.exercises} onStart={start} onImport={() => setTab('import')} onChanged={app.reload} />}
        {tab === 'import' && <ImportReview exercises={data.exercises} imports={data.imports} remaining={data.aiImportsRemaining}
          onBack={() => setTab('program')} onChanged={app.reload} />}
        {tab === 'history' && <HistoryView initial={data.history} preferences={data.preferences} onSession={setDetail} onStart={() => setTab('program')} />}
        {tab === 'exercises' && <ExerciseLibrary exercises={data.exercises} />}
        {tab === 'settings' && <SettingsView account={data.account} preferences={data.preferences} onPreferences={app.savePreferences} notify={setToast} onSignOut={app.signOut} />}
      </main>

      <footer className="page-footer"><span>Built for the long game.</span><span>WORKOUT <ArrowUpRight size={12} /></span></footer>
    </div>

    <nav className="bottom-nav" aria-label="Mobile navigation">{NAV.map(item => <Button key={item.id} variant="tertiary" className={tab === item.id ? 'selected' : ''}
      aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span></Button>)}</nav>

    {data.activeWorkout && !training && <Button className="resume-workout" variant="primary" onClick={() => setTraining(true)}>
      <span className="status-dot" />Resume {data.activeWorkout.name}<ArrowUpRight size={16} /></Button>}

    {training && data.activeWorkout && <Workout session={data.activeWorkout} preferences={data.preferences} exercises={data.exercises} queue={app.queue}
      onSaved={app.setActiveWorkout} onClose={() => setTraining(false)}
      onFinish={async session => { setTraining(false); setDetail(session); setToast('Workout saved. One session stronger.'); await app.reload(); }}
      onDiscard={async () => { setTraining(false); await app.reload(); }} />}

    {preview && <StartPreview template={preview} busy={starting} onCancel={() => setPreview(null)} onConfirm={confirmStart} />}
    {detail && <SessionDetail session={detail} preferences={data.preferences} onClose={() => setDetail(null)} onDeleted={app.reload} />}
    {toast && <div className="toast" role="status"><Plus size={17} />{toast}</div>}
  </div>;
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
  return { connecting: 'Connecting', saving: 'Saving…', saved: 'Saved', failed: 'Not saved', 'signed-out': 'Signed out', idle: 'Ready' }[state] ?? 'Ready';
}

function statusDetail(status: { state: string; message: string }, online: boolean): string {
  if (!online) return 'Logging resumes when you are back online.';
  if (status.state === 'failed') return status.message || 'Refresh to see the saved version.';
  if (status.state === 'saving') return 'Sending your changes to the server.';
  if (status.state === 'saved') return 'Everything is on the server.';
  return 'Your training, saved on the server.';
}
