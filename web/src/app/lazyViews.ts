import { lazy, type ComponentType } from 'react';

// Overview warms alongside authentication; optional screens load on intent.
const loaders = {
  overview: () => import('../components/Dashboard'),
  auth: () => import('../components/Auth'),
  programs: () => import('../components/Programs'),
  settings: () => import('../components/Settings'),
  exercises: () => import('../components/Exercises'),
  importReview: () => import('../components/Import'),
  muscles: () => import('../components/MuscleBalanceView'),
  sessionDetail: () => import('../components/SessionDetail'),
  workout: () => import('../components/Workout'),
  workoutStarting: () => import('../components/WorkoutStarting')
};
type View = keyof typeof loaders;
type Loaded = { [K in View]?: Awaited<ReturnType<(typeof loaders)[K]>> };
const loaded: Loaded = {};

function load<K extends View>(view: K): ReturnType<(typeof loaders)[K]> {
  return loaders[view]().then(module => { loaded[view] = module as Loaded[K]; return module; }) as ReturnType<(typeof loaders)[K]>;
}

/// A view that may already have been fetched by intent (a press, a hover, the Start tap). React
/// suspends a lazy component on its first render even when its module is here, and React 19 holds a
/// revealed boundary for about 300 ms, so a warmed view hands React an already-resolved thenable and
/// renders in the same frame instead.
function instantLazy<K extends View, P extends object>(view: K, pick: (module: NonNullable<Loaded[K]>) => ComponentType<P>) {
  return lazy((): Promise<{ default: ComponentType<P> }> => {
    const ready = loaded[view];
    if (ready) {
      const resolved = { default: pick(ready as NonNullable<Loaded[K]>) };
      return { then: (resolve: (value: typeof resolved) => void) => resolve(resolved) } as unknown as Promise<typeof resolved>;
    }
    return load(view).then(module => ({ default: pick(module as NonNullable<Loaded[K]>) }));
  });
}

export const Dashboard = lazy(() => load('overview').then(module => ({ default: module.Dashboard })));
export const Auth = lazy(() => load('auth').then(module => ({ default: module.Auth })));

export const Programs = lazy(() => load('programs').then(module => ({ default: module.Programs })));
export const SettingsView = lazy(() => load('settings').then(module => ({ default: module.SettingsView })));
export const ExerciseLibrary = lazy(() => load('exercises').then(module => ({ default: module.ExerciseLibrary })));
export const ExerciseDetailModal = lazy(() => load('exercises').then(module => ({ default: module.ExerciseDetailModal })));
export const ImportReview = lazy(() => load('importReview').then(module => ({ default: module.ImportReview })));
export const MuscleBalanceView = lazy(() => load('muscles').then(module => ({ default: module.MuscleBalanceView })));
export const SessionDetail = instantLazy('sessionDetail', module => module.SessionDetail);
export const Workout = instantLazy('workout', module => module.Workout);
// Warmed at idle and shown on the Start tap itself.
export const WorkoutStarting = instantLazy('workoutStarting', module => module.WorkoutStarting);

export function prefetchView(view: View) { void load(view).catch(() => undefined); }

/// Resolves once a view's code is here (at once when it already is), so a surface can open without
/// suspending. A failed load still resolves; the lazy view then reports the failure itself.
export function viewReady(view: View): Promise<void> {
  return loaded[view] ? Promise.resolve() : load(view).then(() => undefined, () => undefined);
}
