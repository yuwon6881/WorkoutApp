import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Link2, RefreshCw } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { consumeCentralAuthError } from '../lib/centralAuthError';
import { Button } from './ui/Button';
import { SettingRow } from './ui/SettingRow';
import { connectedAppActions, parseConnectionState, type ConnectionState } from './connectedAppsState';

export function ConnectedApps() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading');
  const [canRevoke, setCanRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncWarning, setSyncWarning] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const rows = await api.connectedApps();
      const row = rows.find(item => item.peer === 'nutrition');
      setConnectionState(parseConnectionState(row?.connectionState));
      setCanRevoke(row?.canDisconnect === true);
      setSyncWarning(row?.syncWarning === true);
    } catch (failure) {
      setConnectionState('temporary_unavailable');
      setCanRevoke(false);
      setSyncWarning(true);
      setError(failure instanceof ApiError ? failure.message : 'Could not check the Nutrition connection. Try again.');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const notice = consumeCentralAuthError(url);
      if (notice) {
        setBannerNotice({ type: 'error', message: notice });
        window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
    }
  }, [loadStatus]);

  function connect() {
    setBusy(true);
    setError('');
    window.location.href = '/api/auth/central/connect';
  }

  async function revoke() {
    setBusy(true);
    setError('');
    try {
      await api.revokeApp('nutrition');
      setConnectionState('disconnected');
      setCanRevoke(false);
      setSyncWarning(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not confirm Nutrition was disconnected. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<ConnectionState, string> = {
    loading: 'Checking connection…',
    connected: 'Connected',
    temporary_unavailable: 'Temporarily unavailable',
    reconnect_required: 'Reconnect required',
    upgrade_required: 'Reconnect to upgrade',
    disconnected: 'Not connected'
  };
  const actions = connectedAppActions(connectionState, canRevoke);

  return (
    <section className="panel" aria-labelledby="connected-apps-title">
      <div className="section-heading"><h2 id="connected-apps-title">Connected apps</h2></div>
      {bannerNotice && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} />
          <span>{bannerNotice.message}</span>
        </div>
      )}
      <p>Workout can read Nutrition&apos;s confirmed goal, trend, and bodyweight context. Nutrition never changes workout targets.</p>
      <SettingRow
        className="connected-app-item"
        label={
          <div className="connected-app-info">
            <div className="connected-app-title">
              <strong>Nutrition</strong>
              <span className={`pill connected-badge ${connectionState === 'connected' ? 'pill-accent' : ''}`} aria-live="polite">
                {connectionState === 'connected' && <span className="status-dot online" />}
                {statusLabel[connectionState]}
              </span>
            </div>
            <small className="muted">
              {connectionState === 'loading' && 'Checking Fitness Account…'}
              {connectionState === 'connected' && 'Nutrition access is granted.'}
              {connectionState === 'temporary_unavailable' && (syncWarning
                ? 'Workout could not refresh Nutrition data. The connection has not been removed.'
                : 'Workout could not confirm this connection. Try checking again.')}
              {connectionState === 'reconnect_required' && 'Fitness Account no longer recognizes this connection. Connect again to share data.'}
              {connectionState === 'upgrade_required' && 'Reconnect once to move this older connection to durable consent.'}
              {connectionState === 'disconnected' && 'Link your account to share weight trends and goals.'}
            </small>
          </div>
        }
      >
        <div className="connected-app-actions">
          {actions === 'checking' ? (
            <Button variant="tertiary" disabled>Checking…</Button>
          ) : actions === 'retry' || actions === 'retry_disconnect' ? (
            <>
              <Button variant="tertiary" disabled={busy} onClick={() => void loadStatus()}>
                <RefreshCw size={16} /> Try again
              </Button>
              {actions === 'retry_disconnect' && <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>}
            </>
          ) : actions === 'reconnect' || actions === 'reconnect_disconnect' ? (
            <>
              <Button variant="primary" disabled={busy} onClick={connect}>
                <Link2 size={16} />
                {busy ? 'Opening account…' : connectionState === 'upgrade_required' ? 'Reconnect to upgrade' : 'Reconnect Nutrition'}
              </Button>
              {actions === 'reconnect_disconnect' && <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>}
            </>
          ) : actions === 'disconnect' ? (
            <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>
          ) : actions === 'connect' ? (
            <Button variant="primary" disabled={busy} onClick={connect}>
              <Link2 size={16} />
              {busy ? 'Opening account…' : 'Connect Nutrition'}
            </Button>
          ) : null}
        </div>
      </SettingRow>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
