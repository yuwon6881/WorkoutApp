import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { reloadWithFreshShell } from '../../lib/freshShell';
import { Button } from './Button';
import { StartupScreen } from './StartupScreen';
import './CardFeedback.css';

const RELOAD_FLAG = 'workout-chunk-reload';
// Hashed scripts and stylesheets both disappear in a deploy: a lazy view's stylesheet fails through
// lib/featureStyles.ts (or Vite's CSS preload) just as its script does.
const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Unable to preload CSS|could not load its styles/i;

/// A missing file while online means the page is older than the deployment. Offline, the same failure
/// is the connection, which a reload cannot fix.
export const isStaleVersionError = (error: Error): boolean =>
  CHUNK_FAILURE.test(error.message) && (typeof navigator === 'undefined' || navigator.onLine !== false);

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

interface BoundaryState {
  failed: boolean;
  reloading: boolean;
  // The running page is older than the deployed one. React.lazy keeps a rejected import, so a plain
  // re-render throws the same error again: only a fresh shell recovers, and Try again would loop.
  stale: boolean;
  detail: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false, reloading: false, stale: false, detail: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { failed: true, reloading: false, stale: isStaleVersionError(error), detail: error.message || error.name || null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleVersionError(error) && reloadOnceForNewVersion()) return;
    console.error(error, info.componentStack);
  }

  private reload = () => {
    this.setState({ reloading: true });
    void reloadWithFreshShell();
  };

  private reset = () => {
    this.setState({ failed: false, reloading: false, stale: false, detail: null });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { reloading, stale, detail } = this.state;
    return (
      <StartupScreen className="startup-recovery reload-recovery" headingId="reload-heading">
        <div role="alert" className="startup-recovery-copy">
          <span className="recovery-error-icon" aria-hidden="true"><AlertTriangle size={24}/></span>
          <p className="eyebrow">VIEW RECOVERY</p>
          <h1 id="reload-heading">{stale ? 'A new version is available' : 'This view needs a reload'}</h1>
          <p>An active workout stays saved on this device. Reload to continue where you left off.</p>
          {detail && (
            <details className="card-feedback-detail">
              <summary>Technical detail</summary>
              <p>{detail}</p>
            </details>
          )}
        </div>
        <div className="recovery-actions">
          <Button variant="primary" className="full-width" disabled={reloading} onClick={this.reload}>
            <RotateCcw size={16} />
            {reloading ? 'Reloading…' : 'Reload workout app'}
          </Button>
          {!stale && <Button variant="secondary" className="full-width" disabled={reloading} onClick={this.reset}>
            Try again
          </Button>}
        </div>
      </StartupScreen>
    );
  }
}
