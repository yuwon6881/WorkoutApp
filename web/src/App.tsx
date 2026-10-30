// First-screen styles stay eager. Optional feature CSS loads before the shell stylesheet through
// featureCss, so navigating later cannot invert the existing cascade.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Loader2, Plus, RefreshCw, Settings, Sparkles, WifiOff } from 'lucide-react';
import type { AppResource, Bootstrap, Exercise, Session } from './types';
import { ApiError, api } from './lib/api';
import { useApp } from './app/useApp';
import { useShellRestTimer } from './app/useShellRestTimer';
import { useTabNavigation } from './app/useTabNavigation';
import { useSaveIndicator } from './app/useSaveIndicator';
import { useKeyboardInset } from './app/useKeyboardInset';
import { useWorkoutLinkRequest } from './app/useWorkoutLinkRequest';
import { useHeldStart } from './app/useHeldStart';
import { nextWorkout } from './lib/nextWorkout';
import { acknowledgeTemplate } from './lib/templateAcknowledgement';
import { useAppUpdate } from './app/useAppUpdate';
import { usePullToRefresh } from './app/usePullToRefresh';
import { useWindowTier } from './lib/breakpoints';
import { installNativeShell, isStandalone } from './lib/platform';
import { getRecovery } from './lib/workoutRecoveryReads';
import { hasUnresolvedRecovery, sameWorkoutEdits } from './lib/workoutRecoveryComparison';
import { startRecovery } from './lib/workoutRecoveryAccess';
import { Button } from './components/ui/Button';
import { CardFeedback } from './components/ui/CardFeedback';
import { MotionScene } from './components/ui/Motion';
import './components/BottomNav.css';
import { BottomNav, type DockAction } from './components/BottomNav';
import { SideNav } from './components/SideNav';
import { NAV } from './app/navigation';
import { AppLoading } from './components/AppLoading';
import { AuthLoading } from './components/AuthLoading';
import { ViewSkeleton } from './components/ViewSkeleton';
import { Auth, Dashboard, ExerciseDetailModal, ExerciseLibrary, ImportReview, MuscleBalanceView, Programs, SessionDetail, SettingsView, Workout, WorkoutSheet, WorkoutPreviewModal, ResumeWorkoutButton, prefetchView } from './app/lazyViews';
import { AppContexts } from './app/AppContexts';
import { useAppTheme } from './app/useAppTheme';
const AiAssistantPanel = lazy(() => import('./components/AiAssistantPanel').then(module => ({ default: module.AiAssistantPanel })));
const ImportWatchBridge = lazy(() => import('./components/ImportWatchBridge').then(module => ({ default: module.ImportWatchBridge })));
const InstallAppCard = lazy(() => import('./components/InstallAppCard').then(module => ({ default: module.InstallAppCard })));
const ConnectionRecovery = lazy(() => import('./components/ui/ConnectionRecovery').then(module => ({ default: module.ConnectionRecovery })));
import type { AiUiAction } from './lib/api/ai';
import type { AiInvocationRequest } from './components/useAiConversation';

/// Matches the server's refusal in ImportService.Create, so both sides say the same thing.
const IMPORT_BLOCKED_MESSAGE = 'Finish or discard the active workout before importing a program.';

export default function App() {
  const app = useApp();
  const { data, status, loading, signedOut, online } = app;
  const { tab, setTab } = useTabNavigation();
  useKeyboardInset();
  useEffect(() => prefetchView('overview'), []);
  // The workout sheet is small and must be ready the moment Start is tapped, so it warms once the
  // signed-in shell is idle rather than on the tap; it stays out of the first load.
  useEffect(() => {
    if (!data?.account.id) return;
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500));
    idle(() => { prefetchView('workoutSheet'); prefetchView('workoutPreview'); });
  }, [data?.account.id]);
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
  const [exerciseDetail, setExerciseDetail] = useState<Exercise | null>(null);
  const [toast, setToast] = useState('');
  const [starting, setStarting] = useState(false);
  const [startingName, setStartingName] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (preview && !data?.resources?.catalog) void app.ensureResources(['catalog']);
  }, [preview?.id, data?.account.id]);
  useEffect(() => { setPreview(null); }, [data?.account.id, data?.activeWorkout?.id]);
  const heldStart = useHeldStart(app.unconfirmed, Boolean(data));
  const startCancelled = useRef(false);
  // Set when the workout sheet replaces the stand-in shown while starting, so it does not rise twice.
  const [sheetContinues, setSheetContinues] = useState(false);
  useEffect(() => { if (!training) setSheetContinues(false); }, [training]);
  const [actionError, setActionError] = useState('');
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiInvocation, setAiInvocation] = useState<AiInvocationRequest | null>(null);
  const recovery = app.recovery;
  const recoverySession = recovery && (!data || data.account.id === recovery.accountId) ? recovery.draft : null;
  const hasServerWorkout = Boolean(data?.activeWorkout?.active);
  const workoutSession = recoverySession && (reviewRecovery || !hasServerWorkout || data?.activeWorkout?.id === recoverySession.id)
    ? recoverySession : data?.activeWorkout ?? null;
  useEffect(() => { if (training && workoutSession) setStartingName(null); }, [training, workoutSession]);
  const importBlocked = Boolean(workoutSession?.active);
  useEffect(() => { if (importBlocked) prefetchView('resumeWorkout'); }, [importBlocked]);
  useEffect(() => { if (signedOut) void import('./lib/localPdfRead').then(module => module.resetLocalPdfRead()); }, [signedOut]);

  useAppTheme(data?.preferences.theme, signedOut);
  // A session summary credits muscles from the exercise library, which Overview does not load.
  const [detailCatalogSettled, setDetailCatalogSettled] = useState(false);
  useEffect(() => {
    if (!detail || data?.resources?.catalog) return;
    let current = true;
    setDetailCatalogSettled(false);
    void app.ensureResources(['catalog']).finally(() => { if (current) setDetailCatalogSettled(true); });
    return () => { current = false; };
  }, [detail?.id, data?.account.id]);
  const detailCatalogLoading = Boolean(detail) && !data?.resources?.catalog && !detailCatalogSettled;
  const restState = useShellRestTimer({ data, recovery, recoverySession, devicePreferences: app.devicePreferences, setToast });
  // Opens the saved workout when it is found (at launch, or after a conflict) — not each time its
  // queue drains, or a sheet minimized while an edit was still syncing would spring back open.
  useEffect(() => {
    if (recovery && (!data || data.account.id === recovery.accountId) &&
      (!data?.activeWorkout?.active || data.activeWorkout.id === recovery.sessionId || recovery.operations.some(operation => operation.type === 'finish')) &&
      (recovery.operations.length > 0 || recovery.conflict || data?.activeWorkout?.id === recovery.sessionId)) setTraining(true);
  }, [recovery?.sessionId, recovery?.conflict, data?.activeWorkout?.id, data?.account.id]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  /// A workout can become active while the import screen is already open — restored from recovery
  /// on this device, or started on another one. The screen closes rather than staying open around
  /// an upload the server would now refuse, and says why instead of just moving.
  useEffect(() => {
    if (tab === 'import' && importBlocked) { setTab('program'); setToast(IMPORT_BLOCKED_MESSAGE); }
  }, [tab, importBlocked]);
  useWorkoutLinkRequest({
    data, recovery, loading,
    openWorkout: () => setTraining(true), reviewRecovery: () => setReviewRecovery(true), notify: setToast
  });

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
        exercises={[]} queue={app.queue} online={false} recovery={recovery} onRecoveryChange={app.setRecovery} isAccountCurrent={app.isAccountCurrent}
        onSaved={() => undefined} onClose={() => setTraining(false)}
        onFinish={async () => { app.setRecovery(null); setTraining(false); await app.reload(); }}
        onDiscard={async () => { app.setRecovery(null); setTraining(false); await app.reload(); }} /></Suspense> : <section className="panel recovery-card">
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

  /// A Start button always shows the plan first, like opening the day; an open or unresolved
  /// session skips the preview because there is nothing to choose between.
  /** A finished standalone workout that is still saved can be run again; program days follow their run instead. */
  function repeatableTemplateId(session: Session): string | null {
    if (session.active || !session.templateId || session.programId || workoutSession?.active) return null;
    const template = data?.templates?.find(item => item.id === session.templateId);
    return template && !template.programId ? template.id : null;
  }

  function previewWorkout(templateId: string) {
    if (app.unconfirmed) { heldStart.hold({ kind: 'preview', templateId, wasNext: nextWorkout(data!)?.id === templateId }); return; }
    const hasOpenSession = Boolean(data!.activeWorkout?.active)
      || Boolean(recovery && recovery.accountId === data!.account.id && hasUnresolvedRecovery(recovery));
    if (hasOpenSession || starting) { void start(templateId); return; }
    setActionError('');
    setPreview({ id: templateId, name: planName(data!, templateId) });
  }

  const dockAction: DockAction = workoutSession?.active ? 'resume' : nextWorkout(data) ? 'start' : 'choose';
  /// A dock action previews the next plan; an open workout continues immediately.
  function runDockAction() {
    if (app.unconfirmed) { heldStart.hold({ kind: 'dock' }); return; }
    const today = nextWorkout(data!);
    if (dockAction === 'resume') setTraining(true);
    else if (dockAction === 'start' && today) { setActionError(''); setPreview({ id: today.id, name: today.name }); }
    else setTab('program');
  }

  heldStart.release.current = held => {
    if (held.kind === 'dock') { runDockAction(); return; }
    // The next workout may have moved on since the device saved its copy; Start meant that one.
    previewWorkout(held.wasNext ? nextWorkout(data!)?.id ?? held.templateId : held.templateId);
  };

  async function beginWorkout(templateId: string) {
    if (starting || !data) return;
    const currentData = data;
    setStarting(true); setActionError('');
    // The sheet opens on the tap; the workout screen's code loads while the server builds the session.
    // Both are kept out of the first load, which most launches never need them in.
    startCancelled.current = false;
    setStartingName(planName(currentData, templateId));
    prefetchView('workout');
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
        initialRecovery = await startRecovery({
          accountId: currentData.account.id, displayName: currentData.account.displayName, sessionId: session.id,
          draft: session, serverSession: session, preferences: currentData.preferences, activeIndex: 0
        });
      } catch { /* online training can proceed while the UI reports that device recovery is unavailable */ }
      app.setRecovery(initialRecovery);
      app.setActiveWorkout(session);
      // Dismissing the stand-in sheet minimizes the workout rather than cancelling it.
      if (!startCancelled.current) { setSheetContinues(true); setTraining(true); }
    } catch (failure) {
      setActionError(failure instanceof ApiError ? failure.message : 'Could not start that workout.');
      setStartingName(null);
    }
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
    const key = id.trim().toLowerCase();
    const existing = data!.exercises.find(candidate => candidate.id === id || candidate.name.toLowerCase() === key || candidate.slug.toLowerCase() === key || candidate.aliases.some(alias => alias.toLowerCase() === key));
    if (existing) { setExerciseDetail(existing); return; }
    try {
      if (!data!.resources?.catalog) {
        const catalogExercise = (await api.exercises()).find(candidate => candidate.id === id || candidate.name.toLowerCase() === key || candidate.slug.toLowerCase() === key || candidate.aliases.some(alias => alias.toLowerCase() === key));
        if (catalogExercise) { setExerciseDetail(catalogExercise); return; }
      }
      const insight = await api.exerciseInsight(id, '3m', 0, 20);
      const archived: Exercise = {
        id: insight.id, slug: `exercise-${insight.id}`, name: insight.name, muscle: insight.muscle,
        equipment: insight.equipment, aliases: [], loadStepKg: insight.loadStepKg,
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

  return <AppContexts app={app}><div className="app-shell">
    <SideNav
      tab={tab}
      onTab={setTab}
      action={dockAction}
      actionBusy={starting}
      onAction={runDockAction}
      aiOpen={isAiOpen}
      onAskAi={() => setIsAiOpen(true)}
      onSettings={() => setTab('settings')}
      displayName={data.account.displayName}
    />

    {preview && <Suspense fallback={null}><WorkoutPreviewModal key={`${data.account.id}:${preview.id}`}
      templateId={preview.id} name={preview.name} exercises={data.exercises} onClose={() => setPreview(null)}
      unit={data.preferences.unit} defaultRestSeconds={data.preferences.restSeconds ?? 90}
      onStart={id => { setPreview(null); void start(id); }} /></Suspense>}

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
          <Button variant="tertiary" className={`settings-icon ${isAiOpen ? 'selected' : ''}`.trim()} aria-label="Ask AI" aria-expanded={isAiOpen} onClick={() => setIsAiOpen(true)}><Sparkles size={19} /></Button>
          <Button variant="tertiary" className={`settings-icon ${tab === 'settings' ? 'selected' : ''}`.trim()} aria-label="Settings" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><Settings size={19} /></Button>
        </div>
      </header>

      <main>
        {/* Settings reports its own failed preference save beside Retry and Revert, so the page never shows it twice. */}
        {status.state === 'failed' && !(tab === 'settings' && app.preferencePending) && <div className="error-banner" role="alert">
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
        {tab === 'overview' && <Dashboard data={data} onProgram={() => setTab('program')}
            onImport={openImport} onSession={setDetail} onResume={() => setTraining(true)} onChanged={app.reload}
            onExercise={id => { void openExercise(id); }} onStart={previewWorkout} />}
        {!resourcesReady && <ViewSkeleton label={NAV.find(item => item.id === tab)?.label ?? 'Loading'} />}
        {resourcesReady && tab === 'program' && <Programs data={data} exercises={data.exercises} onStart={start} onPreview={previewWorkout} onImport={openImport} onChanged={app.reload} onSession={setDetail}
          ensureResources={app.ensureResources}
          onTemplateSaved={saved => app.setData(current => acknowledgeTemplate(current, saved.id, saved))}
          onTemplateDeleted={id => app.setData(current => acknowledgeTemplate(current, id, null))} />}
        {resourcesReady && tab === 'import' && <ImportReview exercises={data.exercises} imports={data.imports}
          onBack={() => setTab('program')} onChanged={app.reload} notify={setToast} />}
        {tab === 'body' && <MuscleBalanceView timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} refreshKey={data.resourceVersions?.history} onExercise={id => { void openExercise(id); }} />}
        {resourcesReady && tab === 'exercises' && <ExerciseLibrary exercises={data.exercises} unit={data.preferences.unit} onOpen={setExerciseDetail} onChanged={app.reload} />}
        {tab === 'settings' && <SettingsView account={data.account} preferences={data.preferences} devicePreferences={app.devicePreferences} onCatalogChanged={async () => { await app.reload(); }}
          version={__APP_VERSION__}
          onDevicePreferences={app.setDevicePreferences} onPreferences={app.savePreferences} notify={setToast} onSignOut={async () => { await app.signOut(); }}
          preferencePending={app.preferencePending} onRetryPreferences={app.retryPreferences} onRevertPreferences={app.revertPreferences} />}
        </Suspense>
        </MotionScene>
      </main>

    </div>

    <BottomNav tab={tab} onTab={setTab} action={dockAction} actionBusy={starting} onAction={runDockAction} />

    {workoutSession?.active && !training && tab !== 'overview' && <Suspense fallback={null}>
      <ResumeWorkoutButton session={workoutSession} rest={restState} onResume={() => setTraining(true)} />
    </Suspense>}

    <Suspense fallback={null}><ImportWatchBridge imports={data.imports} active={tab !== 'import'} training={training}
      withResume={Boolean(workoutSession?.active)} onOpen={openImport} onFinished={app.reload} onLocalFailure={setToast} /></Suspense>

    {(startingName !== null || (training && workoutSession)) && (
      <Suspense fallback={null}>
        <WorkoutSheet
          title={training && workoutSession ? workoutSession.name : (startingName ?? '')}
          continues={sheetContinues}
          onClose={() => {
            if (training) {
              setTraining(false);
            } else {
              startCancelled.current = true;
              setStartingName(null);
            }
          }}
        >
          {training && workoutSession ? (
            <Workout
              session={workoutSession}
              wrapModal={false}
              continues={sheetContinues}
              accountId={data.account.id}
              isAccountCurrent={app.isAccountCurrent}
              preferences={recovery?.sessionId === workoutSession.id ? recovery.preferences : data.preferences}
              onCatalogNeeded={() => app.ensureResources(['catalog'], true)}
              exercises={data.exercises}
              queue={app.queue}
              online={online}
              recovery={recovery?.sessionId === workoutSession.id ? recovery : null}
              onRecoveryChange={record => { app.setRecovery(record); if (!record) setReviewRecovery(false); }}
              onSaved={app.setActiveWorkout}
              onClose={() => setTraining(false)}
              advance={{ nextExercise: app.devicePreferences.autoAdvance, supersetPartner: app.devicePreferences.supersetAdvance }}
              onCatalogChanged={async () => { await app.reload(); await app.ensureResources(['catalog'], true); }}
              onOpenExercise={id => { void openExercise(id); }}
              onFinish={async session => { app.queue.clear(); app.setActiveWorkout(null); app.setRecovery(null); setTraining(false); setDetail(session); setFinishedId(session.id); setToast('Workout saved.'); await app.reload(); }}
              onDiscard={async () => { app.queue.clear(); app.setActiveWorkout(null); app.setRecovery(null); setTraining(false); await app.reload(); }}
            />
          ) : null}
        </WorkoutSheet>
      </Suspense>
    )}

    <Suspense fallback={null}>
    {detail && <SessionDetail session={detail} preferences={data.preferences} exercises={data.exercises}
      catalogLoading={detailCatalogLoading} justFinished={detail.id === finishedId}
      onClose={() => { setDetail(null); setFinishedId(null); }}
      onExercise={id => { void openExercise(id); }}
      onRepeat={repeatableTemplateId(detail) ? () => { const id = repeatableTemplateId(detail)!; setDetail(null); setFinishedId(null); previewWorkout(id); } : undefined} />}
    {exerciseDetail && <ExerciseDetailModal exercise={exerciseDetail} unit={data.preferences.unit} onClose={() => setExerciseDetail(null)} onChanged={async () => { await app.reload(); }} />}
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
      trainedExercises={data?.progress?.exercises}
    /></Suspense>}
  </div></AppContexts>;
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

/// The name the starting sheet shows: the day or saved workout the tap came from, as far as the
/// loaded resources know it.
function planName(data: Bootstrap, templateId: string): string {
  if (data.nextWorkout?.id === templateId) return data.nextWorkout.name;
  const programDay = [data.activeProgram, ...data.programs].flatMap(program => program?.days ?? []).find(day => day.id === templateId);
  return programDay?.name ?? data.templates.find(template => template.id === templateId)?.name ?? 'Workout';
}
