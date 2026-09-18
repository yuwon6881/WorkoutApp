import { useEffect, useState } from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { consumeCentralAuthError } from '../lib/centralAuthError';
import { Button } from './ui/Button';

export function ConnectedApps() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    api.connectedApps().then(rows => setConnected(rows.some(row => row.peer === 'nutrition' && row.status === 'active')))
      .catch(failure => setError(failure instanceof ApiError ? failure.message : 'Connected app status is unavailable.'));

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const notice = consumeCentralAuthError(url);
      if (notice) {
        setBannerNotice({ type: 'error', message: notice });
        window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
    }
  }, []);

  function connect() {
    setBusy(true); setError('');
    // The backend performs the authorization-code exchange and stores only the encrypted
    // rotating refresh token. The PWA never receives either token.
    window.location.href = '/api/auth/central/connect';
  }

  async function revoke() {
    setBusy(true); setError('');
    try { await api.revokeApp('nutrition'); setConnected(false); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not revoke Nutrition access.'); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="connected-apps-title">
    <div className="section-heading"><h2 id="connected-apps-title">Connected apps</h2></div>
    {bannerNotice && (
      <div className="error-banner" role="alert">
        <AlertTriangle size={17} />
        <span>{bannerNotice.message}</span>
      </div>
    )}
    <p>Workout can read Nutrition’s confirmed goal, trend, and bodyweight context. Nutrition never changes workout targets.</p>
    <div className="connected-app-item">
      <div className="connected-app-info">
        <div className="connected-app-title">
          <strong>Nutrition</strong>
          {connected ? (
            <span className="pill pill-accent connected-badge">
              <span className="status-dot online" /> Connected
            </span>
          ) : (
            <span className="pill connected-badge">Not connected</span>
          )}
        </div>
        <small className="muted">
          {connected ? 'Nutrition access is granted.' : 'Link your account to share weight trends and goals.'}
        </small>
      </div>
      <div className="connected-app-actions">
        {connected ? (
          <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>
            Revoke access
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={connect}>
            <Link2 size={16} />
            {busy ? 'Opening account…' : 'Connect Nutrition'}
          </Button>
        )}
      </div>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
