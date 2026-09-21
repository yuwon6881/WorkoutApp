import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cloud, Dumbbell, LayoutDashboard, Library, Loader2, Plus, RefreshCw, Settings, WifiOff } from 'lucide-react';
import type { Exercise, Session, Template } from './types';
import { ApiError, api } from './lib/api';
import { useApp } from './app/useApp';
import { restTimer } from './lib/restTimer';
import { Button } from './components/ui/Button';
import { MotionScene } from './components/ui/Motion';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Programs } from './components/Programs';
import { Workout } from './components/Workout';
import { clearHistoryViewCache, HistoryView, SessionDetail } from './components/History';
import { SettingsView } from './components/Settings';
import { ExerciseDetailModal, ExerciseLibrary } from './components/Exercises';
import { ImportReview } from './components/Import';
import { StartPreview } from './components/StartPreview';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'program', label: 'Workouts', icon: Dumbbell },
  { id: 'history', label: 'Progress', icon: Activity },
  { id: 'exercises', label: 'Exercises', icon: Library }
];

export default function App() {
  const app = useApp();
  const { data, status, loading, signedOut, online } = app;
  const initialTab = typeof window !== 'undefined' && (window.location.pathname === '/settings' || window.location.search.includes('central_error') || window.location.search.includes('error')) ? 'settings' : 'overview';
  const [tab, setTab] = useState(initialTab);
  const [training, setTraining] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  const [exerciseDetail, setExerciseDetail] = useState<import('./types').Exercise | null>(null);
  const [toast, setToast] = useState('');
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [actionError, setActionError] = useState('');
  const previewRequest = useRef<string | null>(null);

  useEffect(() => {
    const theme = data?.preferences.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) metaTheme.setAttribute('content', bg);
    }
  }, [data?.preferences.theme]);
  // The rest timer belongs to the shell, not the workout view: it has to keep counting while the
  // workout is minimised, and it has to be listening for a resume from a locked screen.
  useEffect(() => restTimer.attach(data?.preferences.restAlerts ?? true), [data?.preferences.restAlerts]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  if (signedOut) return <Auth />;

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
    if (data!.activeWorkout?.active) { setTraining(true); return; }
    if (previewRequest.current === templateId) return;
    previewRequest.current = templateId;
    try { setPreview(await api.getTemplate(templateId)); }
    catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'That workout plan is no longer available. Refresh to see the current list.'); }
    finally { if (previewRequest.current === templateId) previewRequest.current = null; }
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

  async function openExercise(id: string) {
    const existing = data!.exercises.find(candidate => candidate.id === id);
    if (existing) { setExerciseDetail(existing); return; }
    try {
      const insight = await api.exerciseInsight(id, '3m', 0, 20);
      const archived: Exercise = {
        id: insight.id, slug: `exercise-${insight.id}`, name: insight.name, muscle: insight.muscle,
        equipment: insight.equipment, cue: insight.cue, aliases: [], loadStepKg: insight.loadStepKg,
        loadModel: insight.loadModel, source: insight.isCustom ? 'custom' : 'catalog',
        isCustom: insight.isCustom, archived: insight.archived
      };
      setExerciseDetail(archived);
    } catch (failure) {
      setActionError(failure instanceof ApiError ? failure.message : 'That exercise detail is no longer available.');
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" /><span>Workout</span></a>
      <nav aria-label="Main navigation">{NAV.map(item => <Button key={item.id} variant="tertiary" className={`nav-item ${tab === item.id ? 'selected' : ''}`}
        aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>
        <item.icon size={19} /><span>{item.label}</span>{tab === item.id && <span className="nav-dot" />}</Button>)}</nav>
      <div className="sidebar-bottom">
        <Button variant="tertiary" className={`nav-item ${tab === 'settings' ? 'selected' : ''}`} onClick={() => setTab('settings')}><Settings size={19} /> Settings</Button>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <a className="brand mobile-brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" />Workout</a>
        <div className="topbar-actions">
          {online && status.state !== 'idle' && <span className="device-status" role="status"><StatusIcon state={status.state} online={online} /> {statusTitle(status.state, online)}</span>}
          <Button variant="tertiary" className="settings-icon" aria-label="Settings" onClick={() => setTab('settings')}><Settings size={19} /></Button>
        </div>
      </header>

      <main>
        {status.state === 'failed' && <div className="error-banner" role="alert">
          <AlertTriangle size={17} />{status.message || 'A change could not be saved.'}
          <Button variant="tertiary" onClick={() => void app.reload()}><RefreshCw size={15} />Refresh</Button>
        </div>}
        {!online && <div className="error-banner" role="alert"><WifiOff size={17} />You are offline. Workouts are saved on the server, so logging is paused until the connection returns.<Button variant="tertiary" onClick={() => void app.reload()}><RefreshCw size={15} />Retry</Button></div>}
        {actionError && <div className="error-banner" role="alert">{actionError}</div>}

        <MotionScene sceneKey={tab}>
        {tab === 'overview' && <Dashboard data={data} onStart={start} onHistory={() => setTab('history')} onProgram={() => setTab('program')}
            onImport={() => setTab('import')} onSession={setDetail} onResume={() => setTraining(true)} onChanged={app.reload} />}
        {tab === 'program' && <Programs data={data} exercises={data.exercises} onStart={start} onImport={() => setTab('import')} onChanged={app.reload} />}
        {tab === 'import' && <ImportReview exercises={data.exercises} imports={data.imports} remaining={data.aiImportsRemaining}
          onBack={() => setTab('program')} onChanged={app.reload} notify={setToast} />}
        {tab === 'history' && <HistoryView initial={data.history} initialProgress={data.progress} preferences={data.preferences} onSession={setDetail} onStart={() => setTab('program')}
          onExercise={id => { void openExercise(id); }} />}
        {tab === 'exercises' && <ExerciseLibrary exercises={data.exercises} onOpen={setExerciseDetail} onChanged={app.reload} />}
        {tab === 'settings' && <SettingsView account={data.account} preferences={data.preferences} onPreferences={app.savePreferences} notify={setToast} onSignOut={async () => { clearHistoryViewCache(); await app.signOut(); }} />}
        </MotionScene>
      </main>

    </div>

    <nav className="bottom-nav" aria-label="Mobile navigation">{NAV.map(item => <Button key={item.id} variant="tertiary" className={tab === item.id ? 'selected' : ''}
      aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={20} /><span>{item.label}</span></Button>)}</nav>

    {data.activeWorkout?.active && !training && <Button className="resume-workout" variant="primary" onClick={() => setTraining(true)}>
      <span className="status-dot" />Resume {data.activeWorkout.name}</Button>}

    {training && data.activeWorkout?.active && <Workout session={data.activeWorkout} preferences={data.preferences} exercises={data.exercises} queue={app.queue}
      onSaved={app.setActiveWorkout} onClose={() => setTraining(false)}
      onFinish={async session => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); setDetail(session); setToast('Workout saved.'); await app.reload(); }}
      onDiscard={async () => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); await app.reload(); }} />}

    {preview && <StartPreview template={preview} busy={starting} onCancel={() => setPreview(null)} onConfirm={confirmStart} />}
    {detail && <SessionDetail session={detail} preferences={data.preferences} exercises={data.exercises} onClose={() => setDetail(null)} onDeleted={app.reload} />}
    {exerciseDetail && <ExerciseDetailModal exercise={exerciseDetail} unit={data.preferences.unit} onClose={() => setExerciseDetail(null)} onChanged={async () => { clearHistoryViewCache(); await app.reload(); }}
      onSession={session => { setExerciseDetail(null); setDetail(session); }} />}
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
  return { connecting: 'Connecting', saving: 'Saving…', saved: 'Saved', failed: 'Not saved', 'signed-out': 'Signed out' }[state] ?? '';
}
