import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BicepsFlexed, CheckCircle2, Cloud, Dumbbell, LayoutDashboard, Library, Loader2, Plus, RefreshCw, Settings, WifiOff } from 'lucide-react';
import type { Exercise, Session, Template } from './types';
import { ApiError, api } from './lib/api';
import { useApp } from './app/useApp';
import { restTimer } from './lib/restTimer';
import { getWorkoutPushDeviceId } from './lib/push/firebaseMessaging';
import { getRecovery, hasUnresolvedRecovery, sameWorkoutEdits, startRecovery } from './lib/workoutRecovery';
import { Button } from './components/ui/Button';
import { MotionScene, SelectionIndicator } from './components/ui/Motion';
import './components/BottomNav.css';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Programs } from './components/Programs';
const Workout = lazy(() => import('./components/Workout').then(module => ({ default: module.Workout })));
import { clearHistoryViewCache } from './components/History';
import { SessionDetail } from './components/SessionDetail';
import { clearWorkoutHistoryCache } from './components/WorkoutHistory';
import { SettingsView } from './components/Settings';
import { ExerciseDetailModal, ExerciseLibrary } from './components/Exercises';
import { ImportReview } from './components/Import';
import { StartPreview } from './components/StartPreview';
import { MuscleBalanceView } from './components/MuscleBalanceView';
import { ImportProgressPill } from './components/ImportProgressPill';
import { useImportWatch } from './components/useImportWatch';
import { AppLoading } from './components/AppLoading';

/// Matches the server's refusal in ImportService.Create, so both sides say the same thing.
const IMPORT_BLOCKED_MESSAGE = 'Finish or discard the active workout before importing a program.';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'program', label: 'Workouts', icon: Dumbbell },
  { id: 'body', label: 'Muscles', icon: BicepsFlexed },
  { id: 'exercises', label: 'Exercises', icon: Library }
];

export default function App() {
  const app = useApp();
  const { data, status, loading, signedOut, online } = app;
  const initialTab = typeof window !== 'undefined' && (window.location.pathname === '/settings' || window.location.search.includes('central_error') || window.location.search.includes('error')) ? 'settings' : 'overview';
  const [tab, setTab] = useState(initialTab);
  const [training, setTraining] = useState(false);
  const [reviewRecovery, setReviewRecovery] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  // The session just finished, so its summary opens as a result rather than a history entry.
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [exerciseDetail, setExerciseDetail] = useState<import('./types').Exercise | null>(null);
  const [toast, setToast] = useState('');
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [actionError, setActionError] = useState('');
  const previewRequest = useRef<string | null>(null);
  const recovery = app.recovery;
  const recoverySession = recovery && (!data || data.account.id === recovery.accountId) ? recovery.draft : null;
  const hasServerWorkout = Boolean(data?.activeWorkout?.active);
  const workoutSession = recoverySession && (reviewRecovery || !hasServerWorkout || data?.activeWorkout?.id === recoverySession.id)
    ? recoverySession : data?.activeWorkout ?? null;
  const importBlocked = Boolean(workoutSession?.active);
  const importWatch = useImportWatch({
    imports: data?.imports ?? [],
    active: tab !== 'import',
    onFinished: app.reload
  });

  useEffect(() => {
    const theme = data?.preferences.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) metaTheme.setAttribute('content', bg);
    }
  }, [data?.preferences.theme]);
  // The timer belongs to the shell so minimizing the workout does not stop its deadline. The
  // saved timer is account and session scoped and the notification content stays generic.
  const timerAccountId = data?.account.id ?? recovery?.accountId ?? null;
  const timerSessionId = recovery?.conflict && !recovery.serverSession.active
    ? null : recoverySession?.id ?? data?.activeWorkout?.id ?? null;
  const timerNotifications = data?.preferences.restAlerts ?? recovery?.preferences.restAlerts ?? false;
  const [restState, setRestState] = useState(restTimer.current);
  const [pushWakeVersion, setPushWakeVersion] = useState(0);
  const pushDesired = useRef<{ accountId: string; sessionId: string; generation: string; deviceId: string } | null>(null);
  const pushAttempt = useRef<{ key: string; inFlight: boolean; confirmed: boolean } | null>(null);
  const pushWork = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    restTimer.setScope(timerAccountId, timerSessionId, {
      notifications: timerNotifications,
      sound: app.devicePreferences.sound,
      vibration: app.devicePreferences.vibration,
      keepAwake: app.devicePreferences.keepAwake
    });
    return restTimer.attach();
  }, [timerAccountId, timerSessionId, timerNotifications, app.devicePreferences]);
  useEffect(() => {
    setRestState(restTimer.current);
    return restTimer.subscribe(setRestState);
  }, []);
  useEffect(() => {
    const retry = () => setPushWakeVersion(version => version + 1);
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('workout-rest-push-changed', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('workout-rest-push-changed', retry);
    };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      const query = event.data;
      const port = event.ports[0];
      if (!port || query?.type !== 'workout-rest-alert-owner-query' ||
        typeof query.sessionId !== 'string' || typeof query.generation !== 'string') return;
      void (async () => {
        const ownsTimer = document.visibilityState === 'visible' && Boolean(timerAccountId) &&
          timerSessionId === query.sessionId &&
          await restTimer.claimBackgroundAlert(timerAccountId!, query.sessionId, query.generation);
        port.postMessage({
          type: 'workout-rest-alert-owner-response',
          sessionId: query.sessionId,
          generation: query.generation,
          ownsTimer
        });
      })().catch(() => {
        port.postMessage({
          type: 'workout-rest-alert-owner-response',
          sessionId: query.sessionId,
          generation: query.generation,
          ownsTimer: false
        });
      });
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [timerAccountId, timerSessionId, restState.generation]);
  useEffect(() => {
    const enqueue = (work: () => Promise<void>) => {
      const next = pushWork.current.then(work, work);
      pushWork.current = next.catch(() => undefined);
      return next;
    };
    const deviceId = getWorkoutPushDeviceId();
    const running = timerNotifications && Boolean(timerAccountId) && Boolean(timerSessionId) &&
      Boolean(deviceId) && typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
      restState.endsAt > Date.now() && !restState.announced && Boolean(restState.generation) && navigator.onLine;

    if (!running || !deviceId || !timerAccountId || !timerSessionId) {
      const previous = pushDesired.current;
      pushDesired.current = null;
      pushAttempt.current = null;
      if (previous && previous.accountId === timerAccountId) {
        void enqueue(async () => {
          try { await api.cancelRestAlert(previous.sessionId, { deviceId: previous.deviceId, generation: previous.generation }); }
          catch { /* Expiring server-side tasks are safe if cancellation cannot reach the server. */ }
        });
      }
      return;
    }

    const next = { accountId: timerAccountId, sessionId: timerSessionId, generation: restState.generation, deviceId };
    const key = `${next.accountId}:${next.sessionId}:${next.generation}`;
    const previous = pushDesired.current;
    if (previous && previous.accountId === next.accountId && previous.sessionId !== next.sessionId) {
      void enqueue(async () => {
        try { await api.cancelRestAlert(previous.sessionId, { deviceId: previous.deviceId, generation: previous.generation }); }
        catch { /* The old task expires shortly and cannot affect the new workout. */ }
      });
    }
    pushDesired.current = next;
    if (pushAttempt.current?.key === key && (pushAttempt.current.inFlight || pushAttempt.current.confirmed)) return;
    if (pushAttempt.current?.key !== key) pushAttempt.current = { key, inFlight: false, confirmed: false };
    pushAttempt.current = { key, inFlight: true, confirmed: false };
    void enqueue(async () => {
      try {
        if (pushDesired.current?.accountId !== next.accountId || pushDesired.current.sessionId !== next.sessionId ||
          pushDesired.current.generation !== next.generation) return;
        const status = await api.restAlertStatus(deviceId, timerSessionId);
        if (!status.configured || !status.registered) {
          pushAttempt.current = { key, inFlight: false, confirmed: false };
          return;
        }
        if (pushDesired.current?.generation !== next.generation) return;
        const result = await api.scheduleRestAlert(timerSessionId, {
          deviceId, generation: restState.generation, deadline: new Date(restState.endsAt).toISOString(),
          expectedGeneration: status.currentGeneration
        });
        const stillCurrent = pushDesired.current?.accountId === next.accountId && pushDesired.current.sessionId === next.sessionId &&
          pushDesired.current.generation === next.generation;
        if (!stillCurrent) {
          try { await api.cancelRestAlert(next.sessionId, { deviceId, generation: next.generation }); } catch { /* The task expires quickly. */ }
          return;
        }
        pushAttempt.current = { key, inFlight: false, confirmed: result.scheduled };
        if (!result.scheduled) setToast(result.message);
      } catch (failure) {
        pushAttempt.current = { key, inFlight: false, confirmed: false };
        if (failure instanceof ApiError && failure.status === 409) setToast(failure.message);
      }
    });
  }, [data?.preferences.restAlerts, pushWakeVersion, restState, timerAccountId, timerNotifications, timerSessionId]);
  useEffect(() => {
    if (recovery && (!data || data.account.id === recovery.accountId) &&
      (!data?.activeWorkout?.active || data.activeWorkout.id === recovery.sessionId || recovery.operations.some(operation => operation.type === 'finish')) &&
      (recovery.operations.length > 0 || recovery.conflict || data?.activeWorkout?.id === recovery.sessionId)) setTraining(true);
  }, [recovery?.sessionId, recovery?.operations.length, recovery?.conflict, data?.activeWorkout?.id, data?.account.id]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  /// A workout can become active while the import screen is already open — restored from recovery
  /// on this device, or started on another one. The screen closes rather than staying open around
  /// an upload the server would now refuse, and says why instead of just moving.
  useEffect(() => {
    if (tab === 'import' && importBlocked) { setTab('program'); setToast(IMPORT_BLOCKED_MESSAGE); }
  }, [tab, importBlocked]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('workout');
    if (!requested) return;
    if (recovery?.sessionId === requested && (!data || data.account.id === recovery.accountId)) {
      if (data?.activeWorkout?.active && data.activeWorkout.id !== requested) setReviewRecovery(true);
      setTraining(true);
    } else if (data?.activeWorkout?.active && data.activeWorkout.id === requested) setTraining(true);
    else if (data && !loading) setToast('That workout is no longer active on this device.');
    else return;
    const url = new URL(window.location.href);
    url.searchParams.delete('workout');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [recovery?.sessionId, data?.account.id, data?.activeWorkout?.id, loading]);

  if (signedOut) return <Auth />;

  if (loading && !data) return <AppLoading />;

  if (!data && recovery) return <div className="app-shell recovery-shell">
    <main className="recovery-main">
      <div className="error-banner" role="status"><WifiOff size={17} />Offline recovery. This is the active workout previously saved on this device. Changes stay here until you reconnect and the server can confirm them.</div>
      {training && workoutSession ? <Suspense fallback={<div className="panel recovery-card" role="status">Opening your saved workout…</div>}><Workout session={workoutSession} accountId={recovery.accountId} preferences={recovery.preferences}
        exercises={[]} queue={app.queue} online={false} recovery={recovery} onRecoveryChange={app.setRecovery}
        onSaved={() => undefined} onClose={() => setTraining(false)}
        onFinish={async () => { setTraining(false); await app.reload(); }}
        onDiscard={async () => { setTraining(false); await app.reload(); }} /></Suspense> : <section className="panel recovery-card">
        <h1>{recovery.draft.name}</h1><p>Your workout and pending changes are stored on this device.</p>
        <Button variant="primary" onClick={() => setTraining(true)}>Continue workout</Button>
      </section>}
      {!training && <Button variant="tertiary" onClick={() => void app.reload()}><RefreshCw size={16} />Try to reconnect</Button>}
    </main>
  </div>;

  if (!data) return <div className="auth-screen"><div className="panel auth-card">
    <AlertTriangle size={26} /><h1>Could not reach the server</h1>
    <p className="muted">{app.error || 'Check your connection and try again. Nothing has been lost: your training is saved on the server.'}</p>
    <Button variant="primary" onClick={() => void app.reload()}><RefreshCw size={17} />Try again</Button>
  </div></div>;

  /// Opening a plan shows what it contains first. A session is only created on the server once
  /// the preview is confirmed, so backing out leaves nothing behind.
  async function start(templateId: string) {
    setActionError('');
    if (recovery && recovery.accountId === data!.account.id && hasUnresolvedRecovery(recovery)) {
      setActionError('Resolve the saved workout before starting another one. Its local changes are still available for review.');
      setReviewRecovery(true);
      setTraining(true);
      return;
    }
    if (data!.activeWorkout?.active) { setTraining(true); return; }
    if (previewRequest.current === templateId) return;
    previewRequest.current = templateId;
    try { setPreview(await api.getTemplate(templateId)); }
    catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'That workout plan is no longer available. Refresh to see the current list.'); }
    finally { if (previewRequest.current === templateId) previewRequest.current = null; }
  }

  async function confirmStart() {
    if (starting || !preview || !data) return;
    const currentData = data;
    setStarting(true); setActionError('');
    try {
      try {
        const latestRecovery = await getRecovery(currentData.account.id);
        if (latestRecovery && hasUnresolvedRecovery(latestRecovery)) {
          app.setRecovery(latestRecovery);
          setActionError('Resolve the saved workout before starting another one. Its local changes are still available for review.');
          setReviewRecovery(true);
          setTraining(true);
          setPreview(null);
          return;
        }
      } catch { /* server-backed training remains available when local recovery storage is unavailable */ }
      const session = await api.startWorkout(preview.id);
      let initialRecovery = null;
      try {
        await startRecovery({
          accountId: currentData.account.id, displayName: currentData.account.displayName, sessionId: session.id,
          draft: session, serverSession: session, preferences: currentData.preferences, activeIndex: 0, viewMode: 'focus'
        });
        initialRecovery = await getRecovery(currentData.account.id);
      } catch { /* online training can proceed while the UI reports that device recovery is unavailable */ }
      app.setRecovery(initialRecovery);
      app.setActiveWorkout(session);
      setPreview(null);
      setTraining(true);
    } catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'Could not start that workout.'); setPreview(null); }
    finally { setStarting(false); }
  }

  /// Reading a program rewrites the account's programs and the days a session starts from, so it
  /// may not begin while a workout is open. The server refuses it outright; this keeps the app from
  /// offering a screen whose first action would be rejected. Guarding here as well as on the menu
  /// item covers a tab restored from an earlier visit.
  function openImport() {
    if (importBlocked) { setToast(IMPORT_BLOCKED_MESSAGE); return; }
    setTab('import');
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
        {recovery && data.account.id === recovery.accountId && data.activeWorkout?.active && data.activeWorkout.id !== recovery.sessionId &&
          (recovery.conflict || recovery.operations.length > 0 || !sameWorkoutEdits(recovery.draft, recovery.serverSession)) && <div className="error-banner" role="alert">
          <AlertTriangle size={17} />An earlier workout has local changes that need review. They have not been applied to the current workout.
          <Button variant="secondary" onClick={() => { setReviewRecovery(true); setTraining(true); }}>Review saved workout</Button>
        </div>}
        {!online && <div className="error-banner" role="status"><WifiOff size={17} />Offline. Set logging, notes, pause, and finish are saved on this device; exercise-list changes and discard need a connection.<Button variant="tertiary" onClick={() => void app.reload()}><RefreshCw size={15} />Retry</Button></div>}
        {actionError && <div className="error-banner" role="alert">{actionError}</div>}

        <MotionScene sceneKey={tab === 'history' ? 'overview' : tab}>
        {(tab === 'overview' || tab === 'history') && <Dashboard data={data} onStart={start} onProgram={() => setTab('program')}
            onImport={openImport} onSession={setDetail} onResume={() => setTraining(true)} onChanged={app.reload}
            onExercise={id => { void openExercise(id); }} />}
        {tab === 'program' && <Programs data={data} exercises={data.exercises} onStart={start} onImport={openImport} onChanged={app.reload} />}
        {tab === 'import' && <ImportReview exercises={data.exercises} imports={data.imports} remaining={data.aiImportsRemaining}
          onBack={() => setTab('program')} onChanged={app.reload} notify={setToast} />}
        {tab === 'body' && <MuscleBalanceView timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />}
        {tab === 'exercises' && <ExerciseLibrary exercises={data.exercises} onOpen={setExerciseDetail} onChanged={app.reload} />}
        {tab === 'settings' && <SettingsView account={data.account} preferences={data.preferences} devicePreferences={app.devicePreferences}
          version={__APP_VERSION__}
          onDevicePreferences={app.setDevicePreferences} onPreferences={app.savePreferences} notify={setToast} onSignOut={async () => { clearHistoryViewCache(); clearWorkoutHistoryCache(); await app.signOut(); }} />}
        </MotionScene>
      </main>

    </div>

    <nav className="bottom-nav" aria-label="Mobile navigation">
      <SelectionIndicator active={tab} className="bottom-nav-track">
        {NAV.map(item => (
          <Button
            key={item.id}
            data-selection-key={item.id}
            variant="tertiary"
            className={`bottom-nav-item ${tab === item.id ? 'selected' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <span className="bottom-nav-icon-slot">
              <item.icon size={20} />
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </Button>
        ))}
      </SelectionIndicator>
    </nav>

    {workoutSession?.active && !training && <Button className="resume-workout" variant="primary" onClick={() => setTraining(true)}>
      <span className="status-dot" />Resume {workoutSession.name}</Button>}

    {importWatch && !training && <ImportProgressPill progress={importWatch.progress}
      withResume={Boolean(workoutSession?.active)} onOpen={openImport} />}

    {training && workoutSession && <Suspense fallback={<div className="panel recovery-card" role="status">Opening your workout…</div>}><Workout session={workoutSession} accountId={data.account.id} preferences={recovery?.sessionId === workoutSession.id ? recovery.preferences : data.preferences}
      exercises={data.exercises} queue={app.queue} online={online} recovery={recovery?.sessionId === workoutSession.id ? recovery : null} onRecoveryChange={record => { app.setRecovery(record); if (!record) setReviewRecovery(false); }}
      onSaved={app.setActiveWorkout} onClose={() => setTraining(false)}
      onFinish={async session => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); setDetail(session); setFinishedId(session.id); setToast('Workout saved.'); await app.reload(); }}
      onDiscard={async () => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); await app.reload(); }} /></Suspense>}

    {preview && <StartPreview template={preview} busy={starting} onCancel={() => setPreview(null)} onConfirm={confirmStart} />}
    {detail && <SessionDetail session={detail} preferences={data.preferences} exercises={data.exercises} justFinished={detail.id === finishedId}
      onClose={() => { setDetail(null); setFinishedId(null); }} onDeleted={app.reload} />}
    {exerciseDetail && <ExerciseDetailModal exercise={exerciseDetail} unit={data.preferences.unit} onClose={() => setExerciseDetail(null)} onChanged={async () => { clearHistoryViewCache(); clearWorkoutHistoryCache(); await app.reload(); }}
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
