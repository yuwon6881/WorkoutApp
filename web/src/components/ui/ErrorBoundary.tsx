import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

const RELOAD_FLAG = 'workout-chunk-reload';
const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i;

// A deploy replaces hashed chunks, so a long-lived tab can ask for a file that no longer exists.
// One reload per tab session fetches the new shell, so a chunk that is still missing cannot loop;
// the active workout survives the reload through device recovery.
function reloadOnceForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (CHUNK_FAILURE.test(error.message) && reloadOnceForNewVersion()) return;
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-screen" role="alert">
        <section className="panel recovery-card">
          <AlertTriangle size={24} aria-hidden="true" />
          <h1>Something went wrong</h1>
          <p>An active workout stays saved on this device. Reload to continue where you left off.</p>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => location.reload()}>Reload</Button>
          </div>
        </section>
      </main>
    );
  }
}
