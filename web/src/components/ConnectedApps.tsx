import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Link2, RefreshCw, Salad } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { consumeCentralAuthError } from '../lib/centralAuthError';
import { Button } from './ui/Button';
import { connectedAppActions, parseConnectionState, type ConnectionState } from './connectedAppsState';
import './IntegrationCard.css';

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

  // Retry must re-fetch Nutrition data: status alone reports the last refresh result, so
  // re-reading it could never clear a stale sync warning.
  const retry = useCallback(async () => {
    setBusy(true);
    try {
      await api.refreshNutritionContext().catch(() => { /* the status read below reports the outcome */ });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

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
  const actions = connectedAppActions(connectionState, canRevoke, syncWarning);

  const statusTone = connectionState === 'connected' && !syncWarning ? 'is-on'
    : connectionState === 'loading' || connectionState === 'disconnected' ? '' : 'is-warning';

  return (
    <article className="panel integration-card" aria-labelledby="connected-apps-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Salad size={20} /></span>
        <div className="integration-card-title">
          <h3 id="connected-apps-title">Nutrition</h3>
          <span>Confirmed goal, trend weight, and bodyweight context.</span>
        </div>
        <span className={`integration-status ${statusTone}`.trim()} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel[connectionState]}
        </span>
      </header>
      {bannerNotice && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{bannerNotice.message}</span>
        </div>
      )}
      <div className="integration-description">
        {connectionState === 'loading' && 'Checking Fitness Account…'}
        {connectionState === 'connected' && (syncWarning
          ? 'Connected, but Workout could not refresh Nutrition data recently. Try again to refresh it.'
          : 'Nutrition access is granted. Workout reads it to tune suggestions; it never changes Nutrition.')}
        {connectionState === 'temporary_unavailable' && (syncWarning
          ? 'Workout could not refresh Nutrition data. The connection has not been removed.'
          : 'Workout could not confirm this connection. Try checking again.')}
        {connectionState === 'reconnect_required' && 'Fitness Account no longer recognizes this connection. Connect again to share data.'}
        {connectionState === 'upgrade_required' && 'Reconnect once to move this older connection to durable consent.'}
        {connectionState === 'disconnected' && 'Link your account to share weight trends and goals.'}
      </div>
      <div className="integration-actions">
        {actions === 'checking' ? (
          <Button variant="tertiary" disabled>Checking…</Button>
        ) : actions === 'retry' || actions === 'retry_disconnect' ? (
          <>
            {actions === 'retry_disconnect' && <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>}
            <Button variant="secondary" disabled={busy} onClick={() => void retry()}>
              <RefreshCw size={16} aria-hidden="true" /> Try again
            </Button>
          </>
        ) : actions === 'reconnect' || actions === 'reconnect_disconnect' ? (
          <>
            {actions === 'reconnect_disconnect' && <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>}
            <Button variant="primary" disabled={busy} onClick={connect}>
              <Link2 size={16} aria-hidden="true" />
              {busy ? 'Opening account…' : connectionState === 'upgrade_required' ? 'Reconnect to upgrade' : 'Reconnect Nutrition'}
            </Button>
          </>
        ) : actions === 'disconnect' ? (
          <Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Disconnect</Button>
        ) : actions === 'connect' ? (
          <Button variant="primary" disabled={busy} onClick={connect}>
            <Link2 size={16} aria-hidden="true" />
            {busy ? 'Opening account…' : 'Connect Nutrition'}
          </Button>
        ) : null}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}
