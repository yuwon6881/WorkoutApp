// One history model for the whole shell. Tabs are real history entries, and every open sheet adds
// one more, so the Android back gesture (and the browser Back button) closes the top sheet first,
// then walks back through tabs, and only then leaves the app.
//
// Closing a sheet from the UI has to consume its history entry with history.back(), which is
// asynchronous. Pushes requested before that back lands are deferred until it does; otherwise the
// back would pop the new sheet's entry instead of the old one.

const REFUSED_CLOSE_CHECK_MS = 250;

type HistoryLike = Pick<History, 'pushState' | 'replaceState' | 'back' | 'state'>;
type Target = Pick<Window, 'addEventListener' | 'removeEventListener'>;

type Overlay = { id: number; close: () => void; pushed: boolean; closingFromHistory: boolean };
type State = { overlayDepth?: number } | null;

export type BackStack = {
  openOverlay: (close: () => void) => () => void;
  navigate: (path: string) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  depth: () => number;
  dispose: () => void;
};

export function createBackStack(history: HistoryLike, target: Target, currentPath: () => string): BackStack {
  const overlays: Overlay[] = [];
  const pendingPushes: Array<() => void> = [];
  const listeners = new Set<(path: string) => void>();
  let pendingBacks = 0;
  let nextId = 1;

  const stateDepth = (state: State) => (state && typeof state.overlayDepth === 'number' ? state.overlayDepth : 0);

  // A reload can land on an entry a sheet pushed before; nothing is open now, so it is a tab entry.
  if (stateDepth(history.state as State) !== 0) history.replaceState({ overlayDepth: 0 }, '');

  function whenSettled(push: () => void) {
    if (pendingBacks > 0) pendingPushes.push(push);
    else push();
  }

  function pushOverlayEntry(overlay: Overlay) {
    whenSettled(() => {
      if (!overlays.includes(overlay) || overlay.pushed) return;
      history.pushState({ overlayDepth: overlays.indexOf(overlay) + 1 }, '');
      overlay.pushed = true;
    });
  }

  function handlePopState(event: PopStateEvent) {
    if (pendingBacks > 0) {
      pendingBacks -= 1;
      if (pendingBacks === 0) pendingPushes.splice(0).forEach(push => push());
      return;
    }
    const depth = stateDepth(event.state as State);
    // Close from the top down to the depth this entry represents.
    for (let index = overlays.length - 1; index >= depth; index -= 1) {
      const overlay = overlays[index];
      if (!overlay.pushed) continue;
      overlay.pushed = false;
      overlay.closingFromHistory = true;
      overlay.close();
      // A sheet may refuse to close (busy, or a guarded exit). It keeps its entry so the next
      // back press still reaches it instead of silently leaving the screen. The check waits past
      // React's commit, which happens after this event rather than inside it.
      setTimeout(() => {
        if (overlays.includes(overlay) && overlay.closingFromHistory) {
          overlay.closingFromHistory = false;
          pushOverlayEntry(overlay);
        }
      }, REFUSED_CLOSE_CHECK_MS);
    }
    if (depth > overlays.length) history.replaceState({ overlayDepth: overlays.length }, '');
    const path = currentPath();
    listeners.forEach(listener => listener(path));
  }

  target.addEventListener('popstate', handlePopState as EventListener);

  return {
    openOverlay(close) {
      const overlay: Overlay = { id: nextId++, close, pushed: false, closingFromHistory: false };
      overlays.push(overlay);
      pushOverlayEntry(overlay);
      return () => {
        const index = overlays.indexOf(overlay);
        if (index < 0) return;
        overlays.splice(index, 1);
        // Closed from the UI: consume the entry it added so Back does not reopen nothing.
        if (overlay.pushed && !overlay.closingFromHistory) {
          overlay.pushed = false;
          pendingBacks += 1;
          history.back();
        }
      };
    },
    navigate(path) {
      whenSettled(() => {
        if (path === currentPath()) return;
        history.pushState({ overlayDepth: 0 }, '', path);
      });
    },
    onNavigate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    depth: () => overlays.length,
    dispose() {
      target.removeEventListener('popstate', handlePopState as EventListener);
      listeners.clear();
    }
  };
}

let shared: BackStack | null = null;

export function backStack(): BackStack | null {
  if (typeof window === 'undefined') return null;
  shared ??= createBackStack(window.history, window, () => window.location.pathname);
  return shared;
}
