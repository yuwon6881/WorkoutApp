import { lazy } from 'react';

// Overview warms alongside authentication; optional screens load on intent.
const loaders = {
  overview: () => import('../components/Dashboard'),
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
export const Dashboard = lazy(() => loaders.overview().then(module => ({ default: module.Dashboard })));
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
