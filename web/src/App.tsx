// First-screen styles stay eager. Optional feature CSS loads before the shell stylesheet through
// featureCss, so navigating later cannot invert the existing cascade.
import { lazy, Suspense, useEffect, useState } from 'react';
import { AlertTriangle, BicepsFlexed, CheckCircle2, Cloud, Dumbbell, LayoutDashboard, Library, Loader2, Plus, RefreshCw, Settings, Sparkles, WifiOff } from 'lucide-react';
import type { AppResource, Exercise, Session } from './types';
import { ApiError, api } from './lib/api';
import { useApp } from './app/useApp';
import { useShellRestTimer } from './app/useShellRestTimer';
import { useTabNavigation } from './app/useTabNavigation';
import { useSaveIndicator } from './app/useSaveIndicator';
import { useKeyboardInset } from './app/useKeyboardInset';
import { nextWorkout } from './lib/nextWorkout';
import { acknowledgeTemplate } from './lib/templateAcknowledgement';
import { useAppUpdate } from './app/useAppUpdate';
import { usePullToRefresh } from './app/usePullToRefresh';
import { useWindowTier } from './lib/breakpoints';
import { installNativeShell, isStandalone, setNativeStatusBar } from './lib/platform';
import type { Tab } from './app/useTabNavigation';
import { getRecovery, hasUnresolvedRecovery, sameWorkoutEdits, startRecovery } from './lib/workoutRecovery';
import { Button } from './components/ui/Button';
import {CardFeedback} from './components/ui/CardFeedback';
import { MotionScene, SelectionIndicator } from './components/ui/Motion';
import './components/BottomNav.css';
import { AppLoading } from './components/AppLoading';
import { AuthLoading } from './components/AuthLoading';
import { ViewSkeleton } from './components/ViewSkeleton';
import { Auth, Dashboard, ExerciseDetailModal, ExerciseLibrary, ImportReview, MuscleBalanceView, Programs, SessionDetail, SettingsView, Workout, prefetchView } from './app/lazyViews';
import { ResumeWorkoutButton } from './components/ResumeWorkoutButton';
import { TrackRirContext, tracksRir } from './lib/trackRir';
import {applyTheme, forgetTheme, initialTheme, rememberTheme} from './lib/theme';
const AiAssistantPanel = lazy(() => import('./components/AiAssistantPanel').then(module => ({ default: module.AiAssistantPanel })));
const ImportWatchBridge = lazy(() => import('./components/ImportWatchBridge').then(module => ({ default: module.ImportWatchBridge })));
const InstallAppCard = lazy(() => import('./components/InstallAppCard').then(module => ({ default: module.InstallAppCard })));
const ConnectionRecovery = lazy(() => import('./components/ui/ConnectionRecovery').then(module => ({ default: module.ConnectionRecovery })));
import type { AiUiAction } from './lib/api/ai';
import type { AiInvocationRequest } from './components/useAiConversation';

/// Matches the server's refusal in ImportService.Create, so both sides say the same thing.
const IMPORT_BLOCKED_MESSAGE = 'Finish or discard the active workout before importing a program.';

const NAV: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'program', label: 'Workouts', icon: Dumbbell },
  { id: 'body', label: 'Muscles', icon: BicepsFlexed },
  { id: 'exercises', label: 'Exercises', icon: Library }
];

export default function App() {
  const app = useApp();
  const { data, status, loading, signedOut, online } = app;
  const { tab, setTab } = useTabNavigation();
  useKeyboardInset();
  useEffect(() => prefetchView('overview'), []);
  useEffect(() => installNativeShell(), []);
  const appUpdate = useAppUpdate();
  // Offline has its own banner, so the top bar only reports saves while connected.
  const saveIndicator = useSaveIndicator(status);
  const showSaveStatus = online && saveIndicator !== 'hidden';
  const [training, setTraining] = useState(false);
  const neededResources: AppResource[] = tab === 'program' ? ['catalog', 'programs', 'templates']
    : tab === 'exercises' || tab === 'import' ? ['catalog'] : [];
  const resourcesReady = neededResources.every(resource => (data?.resources?.[resource] || data?.loadedResources?.[resource]));
  useEffect(() => {
    if (data && neededResources.some(resource => !data.resources?.[resource])) void app.ensureResources(neededResources);
  }, [tab, data?.account.id, data?.resources, resourcesReady, training]);

  // A browser tab already has its own pull-to-refresh; the installed and Android apps do not.
  const pullToRefresh = usePullToRefresh(app.reload, useWindowTier() === 'compact' && isStandalone() && !training && online);
  const [reviewRecovery, setReviewRecovery] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  // The session just finished, so its summary opens as a result rather than a history entry.
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [exerciseDetail, setExerciseDetail] = useState<import('./types').Exercise | null>(null);
  const [toast, setToast] = useState('');
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiInvocation, setAiInvocation] = useState<AiInvocationRequest | null>(null);
  const recovery = app.recovery;
  const recoverySession = recovery && (!data || data.account.id === recovery.accountId) ? recovery.draft : null;
  const hasServerWorkout = Boolean(data?.activeWorkout?.active);
  const workoutSession = recoverySession && (reviewRecovery || !hasServerWorkout || data?.activeWorkout?.id === recoverySession.id)
    ? recoverySession : data?.activeWorkout ?? null;
  const importBlocked = Boolean(workoutSession?.active);
  useEffect(() => { if (signedOut) void import('./lib/localPdfRead').then(module => module.resetLocalPdfRead()); }, [signedOut]);

  useEffect(() => {
    const saved = data?.preferences.theme;
    // Signing out drops the device copy so the sign-in screen follows the browser or OS.
    if (signedOut) forgetTheme();
    const sync = () => {
      const theme = saved ?? initialTheme();
      applyTheme(theme);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) setNativeStatusBar(theme === 'light' ? 'light' : 'dark', bg);
    };
    if (saved) rememberTheme(saved);
    sync();
    if (saved) return undefined;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', sync);
    return () => media?.removeEventListener('change', sync);
  }, [data?.preferences.theme, signedOut]);
  const restState = useShellRestTimer({ data, recovery, recoverySession, devicePreferences: app.devicePreferences, setToast });
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
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [recovery?.sessionId, data?.account.id, data?.activeWorkout?.id, loading]);

  // The home-screen shortcut opens /?start=today: resume what is open, or start today's workout.
  useEffect(() => {
    if (!data || loading || new URLSearchParams(window.location.search).get('start') !== 'today') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('start');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (data.activeWorkout?.active) { setTraining(true); return; }
    const today = nextWorkout(data);
    if (today) void start(today.id);
    else setToast('No workout is queued yet. Choose one from Workouts.');
  }, [data?.account.id, loading]);

  if (signedOut) return <Suspense fallback={<AuthLoading />}><Auth /></Suspense>;

  if (loading && !data && !recovery) return <AppLoading />;

  if (!data && recovery) return <div className="app-shell recovery-shell">
    <main className="recovery-main">
      <div className="error-banner" role="status"><WifiOff size={17} />{loading ? 'Checking your connection. Your saved workout is available; changes stay on this device until your account is confirmed.' : 'Offline recovery. This is the active workout previously saved on this device. Changes stay here until you reconnect and the server can confirm them.'}</div>
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

  if (!data) return <Suspense fallback={<AppLoading />}><ConnectionRecovery message={app.error} onRetry={app.reload}/></Suspense>;

  /// Starting a plan creates the session at once: its content is already on the card that offered
  /// it. Anything unresolved on this device still comes first.
  async function start(templateId: string) {
    setActionError('');
    if (recovery && recovery.accountId === data!.account.id && hasUnresolvedRecovery(recovery)) {
      setActionError('Resolve the saved workout before starting another one. Its local changes are still available for review.');
      setReviewRecovery(true);
      setTraining(true);
      return;
    }
    if (data!.activeWorkout?.active) { setTraining(true); return; }
    await beginWorkout(templateId);
  }

  async function beginWorkout(templateId: string) {
    if (starting || !data) return;
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
          return;
        }
      } catch { /* server-backed training remains available when local recovery storage is unavailable */ }
      const session = await api.startWorkout(templateId);
      let initialRecovery = null;
      try {
        await startRecovery({
          accountId: currentData.account.id, displayName: currentData.account.displayName, sessionId: session.id,
          draft: session, serverSession: session, preferences: currentData.preferences, activeIndex: 0
        });
        initialRecovery = await getRecovery(currentData.account.id);
      } catch { /* online training can proceed while the UI reports that device recovery is unavailable */ }
      app.setRecovery(initialRecovery);
      app.setActiveWorkout(session);
      setTraining(true);
    } catch (failure) { setActionError(failure instanceof ApiError ? failure.message : 'Could not start that workout.'); }
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

  async function handleAiActions(actions: AiUiAction[]) {
    for (const action of actions) {
      switch (action.type) {
        case 'openWorkout': {
          const wid = action.payload.workoutId as string | undefined;
          if (wid) {
            try {
              const session = await api.getWorkout(wid);
              if (session) setDetail(session);
            } catch {
              setActionError("That workout is no longer available. Refresh and try again.");
            }
          }
          break;
        }
        case 'openExercise': {
          const slugOrId = (action.payload.slug ?? action.payload.exerciseId) as string | undefined;
          if (slugOrId) {
            const match = data?.exercises.find(e => e.slug === slugOrId || e.id === slugOrId);
            if (match) await openExercise(match.id);
            else if (typeof action.payload.exerciseId === 'string') await openExercise(action.payload.exerciseId);
            else setTab('exercises');
          }
          break;
        }
        case 'openProgram':
          setTab('program');
          break;
        case 'openHistory':
          setTab('overview');
          break;
        case 'openActiveWorkout':
          if (data?.activeWorkout?.active) setTraining(true);
          break;
        // Ask AI only ever opens a screen: a session starts from a Start button the lifter taps.
        case 'openAddWorkoutDraft':
          setTab('program');
          break;
      }
    }
  }

  return <TrackRirContext value={tracksRir(data.preferences)}><div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" /><span>Workout</span></a>
      <nav aria-label="Main navigation">{NAV.map(item => <Button key={item.id} variant="tertiary" className={`nav-item ${tab === item.id ? 'selected' : ''}`}
        aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>
        <item.icon size={19} /><span>{item.label}</span>{tab === item.id && <span className="nav-dot" />}</Button>)}</nav>
      <div className="sidebar-bottom">
        <Button variant="tertiary" className="nav-item" onClick={() => setIsAiOpen(true)}><Sparkles size={19} /><span>Ask AI</span></Button>
        <Button variant="tertiary" className={`nav-item ${tab === 'settings' ? 'selected' : ''}`} onClick={() => setTab('settings')}><Settings size={19} /> Settings</Button>
      </div>
    </aside>

    <div className="workspace">
      {(pullToRefresh.pull > 0 || pullToRefresh.refreshing) && <div className={`pull-refresh ${pullToRefresh.ready || pullToRefresh.refreshing ? 'ready' : ''}`.trim()}
        style={{ height: pullToRefresh.refreshing ? 48 : pullToRefresh.pull }} role="status" aria-label={pullToRefresh.refreshing ? 'Refreshing' : 'Pull to refresh'}>
        <RefreshCw size={18} className={pullToRefresh.refreshing ? 'spin' : undefined} style={{ transform: `rotate(${pullToRefresh.pull * 3}deg)` }} />
      </div>}
      <header className="topbar">
        <a className="brand mobile-brand" href="#" onClick={e => { e.preventDefault(); setTab('overview'); }}><img src="/favicon.svg" alt="" />Workout</a>
        <div className="topbar-actions">
          {/* A fixed slot: the status fades in and out without moving anything around it. */}
          <span className={`device-status save-indicator ${showSaveStatus ? 'visible' : ''}`.trim()} role="status">
            {showSaveStatus && <><StatusIcon state={status.state} online={online} /> {statusTitle(status.state, online)}</>}
          </span>
          <Button variant="tertiary" className="settings-icon" aria-label="Ask AI" onClick={() => setIsAiOpen(true)}><Sparkles size={19} /></Button>
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
        {actionError && <CardFeedback title="Could not complete this action" message={actionError}/>}
        {tab === 'overview' && <Suspense fallback={null}><InstallAppCard /></Suspense>}

        {app.resourceError && <CardFeedback tone="warning" title="Could not load this view" message={app.resourceError}
          action={{label:'Retry',onClick:()=>void app.ensureResources(neededResources),disabled:loading}}/>}
        <MotionScene sceneKey={tab}>
        <Suspense fallback={<ViewSkeleton label={NAV.find(item => item.id === tab)?.label ?? (tab === 'import' ? 'Import' : 'Settings')} />}>
        {tab === 'overview' && <Dashboard data={data} onStart={start} onProgram={() => setTab('program')}
            onImport={openImport} onSession={setDetail} onResume={() => setTraining(true)} onChanged={app.reload}
            onExercise={id => { void openExercise(id); }} />}
        {!resourcesReady && <ViewSkeleton label={NAV.find(item => item.id === tab)?.label ?? 'Loading'} />}
        {resourcesReady && tab === 'program' && <Programs data={data} exercises={data.exercises} onStart={start} onImport={openImport} onChanged={app.reload}
          onTemplateSaved={saved => app.setData(current => acknowledgeTemplate(current, saved.id, saved))}
          onTemplateDeleted={id => app.setData(current => acknowledgeTemplate(current, id, null))} />}
        {resourcesReady && tab === 'import' && <ImportReview exercises={data.exercises} imports={data.imports}
          onBack={() => setTab('program')} onChanged={app.reload} notify={setToast} />}
        {tab === 'body' && <MuscleBalanceView timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />}
        {resourcesReady && tab === 'exercises' && <ExerciseLibrary exercises={data.exercises} onOpen={setExerciseDetail} onChanged={app.reload} />}
        {tab === 'settings' && <SettingsView account={data.account} preferences={data.preferences} devicePreferences={app.devicePreferences} onCatalogChanged={async () => { await app.reload(); }}
          version={__APP_VERSION__}
          onDevicePreferences={app.setDevicePreferences} onPreferences={app.savePreferences} notify={setToast} onSignOut={async () => { await app.signOut(); }} />}
        </Suspense>
        </MotionScene>
      </main>

    </div>

    <nav className="bottom-nav" aria-label="Mobile navigation">
      <SelectionIndicator active={tab} className="bottom-nav-track">
        {NAV.map(item => (
          <Button
            key={item.id}
            data-selection-key={item.id}
            onPointerEnter={() => prefetchView(item.id === 'program' ? 'programs' : item.id === 'body' ? 'muscles' : item.id === 'exercises' ? 'exercises' : 'workout')}
            onFocus={() => prefetchView(item.id === 'program' ? 'programs' : item.id === 'body' ? 'muscles' : item.id === 'exercises' ? 'exercises' : 'workout')}
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

    {workoutSession?.active && !training && <ResumeWorkoutButton name={workoutSession.name} rest={restState} onResume={() => setTraining(true)} />}

    <Suspense fallback={null}><ImportWatchBridge imports={data.imports} active={tab !== 'import'} training={training}
      withResume={Boolean(workoutSession?.active)} onOpen={openImport} onFinished={app.reload} onLocalFailure={setToast} /></Suspense>

    {training && workoutSession && <Suspense fallback={<div className="panel recovery-card" role="status">Opening your workout…</div>}><Workout session={workoutSession} accountId={data.account.id} preferences={recovery?.sessionId === workoutSession.id ? recovery.preferences : data.preferences}
      onCatalogNeeded={() => app.ensureResources(['catalog'], true)} exercises={data.exercises} queue={app.queue} online={online} recovery={recovery?.sessionId === workoutSession.id ? recovery : null} onRecoveryChange={record => { app.setRecovery(record); if (!record) setReviewRecovery(false); }}
      onSaved={app.setActiveWorkout} onClose={() => setTraining(false)} advance={{ nextExercise: app.devicePreferences.autoAdvance, supersetPartner: app.devicePreferences.supersetAdvance }} onCatalogChanged={async () => { await app.reload(); await app.ensureResources(['catalog'], true); }}
      onFinish={async session => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); setDetail(session); setFinishedId(session.id); setToast('Workout saved.'); await app.reload(); }}
      onDiscard={async () => { app.queue.clear(); app.setActiveWorkout(null); setTraining(false); await app.reload(); }} /></Suspense>}

    <Suspense fallback={null}>
    {detail && <SessionDetail session={detail} preferences={data.preferences} exercises={data.exercises} justFinished={detail.id === finishedId}
      onClose={() => { setDetail(null); setFinishedId(null); }} onDeleted={app.reload} />}
    {exerciseDetail && <ExerciseDetailModal exercise={exerciseDetail} unit={data.preferences.unit} onClose={() => setExerciseDetail(null)} onChanged={async () => { await app.reload(); }}
      onSession={session => { setExerciseDetail(null); setDetail(session); }} />}
    {appUpdate.ready && !training && !workoutSession?.active && <div className="update-banner" role="status">
      <span>A new version of Workout is ready.</span>
      <Button variant="primary" onClick={appUpdate.apply}>Reload</Button>
    </div>}
    </Suspense>
    {toast && <div className="toast" role="status"><Plus size={17} />{toast}</div>}
    {isAiOpen && <Suspense fallback={null}><AiAssistantPanel
      isOpen={isAiOpen}
      onClose={() => setIsAiOpen(false)}
      onActions={handleAiActions}
      invocation={aiInvocation}
      onInvocationConsumed={() => setAiInvocation(null)}
      surface={tab}
    /></Suspense>}
  </div></TrackRirContext>;
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
