import { lazy } from 'react';

// Overview is the first screen, so it ships in the main bundle; every other view loads when it is
// first opened. Only the likely next workout view is warmed while the screen is idle.
const loaders = {
  auth: () => import('../components/Auth'),
  programs: () => import('../components/Programs'),
  settings: () => import('../components/Settings'),
  exercises: () => import('../components/Exercises'),
  importReview: () => import('../components/Import'),
  startPreview: () => import('../components/StartPreview'),
  muscles: () => import('../components/MuscleBalanceView'),
  sessionDetail: () => import('../components/SessionDetail'),
  workout: () => import('../components/Workout')
};
export const Auth = lazy(() => loaders.auth().then(module => ({ default: module.Auth })));

export const Programs = lazy(() => loaders.programs().then(module => ({ default: module.Programs })));
export const SettingsView = lazy(() => loaders.settings().then(module => ({ default: module.SettingsView })));
export const ExerciseLibrary = lazy(() => loaders.exercises().then(module => ({ default: module.ExerciseLibrary })));
export const ExerciseDetailModal = lazy(() => loaders.exercises().then(module => ({ default: module.ExerciseDetailModal })));
export const ImportReview = lazy(() => loaders.importReview().then(module => ({ default: module.ImportReview })));
export const StartPreview = lazy(() => loaders.startPreview().then(module => ({ default: module.StartPreview })));
export const MuscleBalanceView = lazy(() => loaders.muscles().then(module => ({ default: module.MuscleBalanceView })));
export const SessionDetail = lazy(() => loaders.sessionDetail().then(module => ({ default: module.SessionDetail })));
export const Workout = lazy(() => loaders.workout().then(module => ({ default: module.Workout })));

type View = keyof typeof loaders;
export function prefetchView(view: View) { void loaders[view]().catch(() => undefined); }

export function prefetchViews() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return () => undefined;
  const warm = () => { if (document.visibilityState === 'visible') prefetchView('workout'); };
  const idle = window as Window & { requestIdleCallback?: (callback: () => void) => number; cancelIdleCallback?: (id: number) => void };
  if (idle.requestIdleCallback) {
    const id = idle.requestIdleCallback(warm);
    return () => idle.cancelIdleCallback?.(id);
  }
  const id = setTimeout(warm, 1500);
  return () => clearTimeout(id);
}
