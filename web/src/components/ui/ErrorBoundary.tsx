import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reloadWithFreshShell } from '../../lib/freshShell';
import { Button } from './Button';
import './CardFeedback.css';

const RELOAD_FLAG = 'workout-chunk-reload';
const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i;

// A deploy replaces hashed chunks, so a long-lived tab can ask for a file that no longer exists.
// One reload per tab session fetches the new shell, so a chunk that is still missing cannot loop;
// the active workout survives the reload through device recovery. The reload also drops the service
// worker's cached shell, which is what keeps requesting the deleted chunks.
function reloadOnceForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  void reloadWithFreshShell();
  return true;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; reloading: boolean }> {
  state = { failed: false, reloading: false };

  static getDerivedStateFromError() {
    return { failed: true, reloading: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (CHUNK_FAILURE.test(error.message) && reloadOnceForNewVersion()) return;
    console.error(error, info.componentStack);
  }

  private reload = () => {
    this.setState({ reloading: true });
    void reloadWithFreshShell();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-screen" role="alert">
        <section className="panel recovery-card">
          <span className="recovery-error-icon" aria-hidden="true"><AlertTriangle size={24}/></span>
          <h1>This view needs a reload</h1>
          <p>An active workout stays saved on this device. Reload to continue where you left off.</p>
          <div className="modal-actions">
            <Button variant="primary" disabled={this.state.reloading} onClick={this.reload}>{this.state.reloading ? 'Reloading…' : 'Reload'}</Button>
          </div>
        </section>
      </main>
    );
  }
}
