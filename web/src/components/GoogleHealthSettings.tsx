import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import {
  recoverGoogleHealthWorkoutSync,
  setGoogleHealthWorkoutSync,
  useGoogleHealth,
} from '../lib/googleHealth';
import { GoogleHealthDisclosure } from './GoogleHealthDisclosure';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Unlink } from 'lucide-react';

export function GoogleHealthSettings() {
  const { state, loading, error: syncError, refresh, connect, disconnect } = useGoogleHealth();
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [requestWorkoutSync, setRequestWorkoutSync] = useState(true);
  const [workoutActionLoading, setWorkoutActionLoading] = useState(false);

  const openDisclosure = () => {
    setRequestWorkoutSync(state.workoutSync.enabled);
    setDisclosureOpen(true);
  };

  // Check URL parameters for OAuth redirect results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ghResult = params.get('google_health');
    const code = params.get('code');

    if (ghResult === 'connected') {
      setBannerNotice({
        type: 'success',
        message: 'Google Health connected successfully.',
      });
      setActionError('');
      void refresh(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    } else if (ghResult === 'error') {
      let msg = 'Google Health connection was not completed.';
      if (code === 'duplicate_account') {
        msg = 'This Google account is already linked to another Workout account. Each Google account can only connect once.';
      } else if (code === 'identity_change_requires_disconnect') {
        msg = 'This Workout account is already linked to a different Google account. Disconnect it before connecting another account.';
      } else if (code === 'session_mismatch' || code === 'session_expired') {
        msg = 'Your Workout session changed during connection. Please sign in and try again.';
      } else if (code === 'access_denied') {
        msg = 'Access was denied in Google permissions.';
      } else if (code === 'invalid_state') {
        msg = 'Connection session expired. Please start the connection again.';
      } else if (code === 'identity_resolution_failed') {
        msg = 'Google granted access, but its account identity could not be confirmed. Try again, and contact support if it continues.';
      } else if (code === 'token_exchange_failed') {
        msg = 'Google could not finish the authorization exchange. Check the configured redirect URI and try again.';
      } else if (code === 'missing_tokens') {
        msg = 'Google did not return the required authorization tokens. Remove this app from your Google account and reconnect.';
      } else if (code === 'encryption_failed') {
        msg = 'Workout could not securely store the Google connection. Try again later.';
      } else if (code === 'missing_parameters') {
        msg = 'Google returned an incomplete authorization response. Please start the connection again.';
      } else if (code === 'provider_error') {
        msg = 'Google returned an unexpected authorization error. Please try again.';
      }
      setBannerNotice({ type: 'error', message: msg });
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    }
  }, [refresh]);

  const handleStartConnect = async () => {
    setConnecting(true);
    setActionError('');
    try {
      const { authUrl } = await connect({
        syncWorkout: requestWorkoutSync,
      });
      window.location.href = authUrl;
    } catch (err: unknown) {
      setConnecting(false);
      setActionError(err instanceof Error ? err.message : 'Failed to generate Google connection URL.');
    }
  };

  const handleDisconnectConfirm = async () => {
    setDisconnecting(true);
    setActionError('');
    try {
      await disconnect();
      setDisconnectOpen(false);
      setBannerNotice({
        type: 'success',
        message: 'Google Health has been disconnected.',
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to disconnect Google Health.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleWorkoutSyncToggle = async (enabled: boolean) => {
    if (!state.workoutSync.permissionGranted && enabled) {
      openDisclosure();
      return;
    }
    setWorkoutActionLoading(true);
    setActionError('');
    try {
      await setGoogleHealthWorkoutSync(enabled, state.workoutSync.revision);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Could not change workout sync preference.');
    } finally {
      setWorkoutActionLoading(false);
    }
  };

  const handleWorkoutRecover = async () => {
    setWorkoutActionLoading(true);
    setActionError('');
    try {
      await recoverGoogleHealthWorkoutSync();
      void refresh(true);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to recover workout synchronization.');
    } finally {
      setWorkoutActionLoading(false);
    }
  };

  const isConnected = state.status === 'connected';
  const isReconnectRequired = state.status === 'reconnect_required';

  return (
    <section className="panel" aria-labelledby="google-health-title">
      <div className="section-heading">
        <h2 id="google-health-title">Google Health</h2>
      </div>

      {bannerNotice && (
        <div
          className={bannerNotice.type === 'error' ? 'error-banner' : 'card-feedback card-feedback-success'}
          role="alert"
          style={{ marginBottom: '1rem' }}
        >
          {bannerNotice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{bannerNotice.message}</span>
        </div>
      )}

      {actionError && (
        <div className="error-banner" role="alert" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={17} />
          <span>{actionError}</span>
        </div>
      )}

      {syncError && (
        <div className="error-banner" role="alert" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={17} />
          <span>{syncError}</span>
        </div>
      )}

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Connect Google Health to sync your completed workouts, exercise sets, and training volume.
      </p>

      <SettingRow className="connected-app-item" label={
        <div className="connected-app-info">
          <div className="connected-app-title">
            <Activity size={18} className="accent" />
            <strong>Google Health Connection</strong>
            <span
              className={`pill connected-badge ${isConnected ? 'pill-accent' : ''}`}
              aria-live="polite"
            >
              {isConnected && <span className="status-dot online" />}
              {isConnected
                ? 'Connected'
                : isReconnectRequired
                  ? 'Reconnect required'
                  : 'Not connected'}
            </span>
          </div>
          <small className="muted">
            {isConnected
              ? `Connected${state.connectedAt ? ` on ${new Date(state.connectedAt).toLocaleDateString()}` : ''}.`
              : isReconnectRequired
                ? 'Your Google authorization expired or permissions changed. Reconnect to resume sync.'
                : 'Link your Google account to sync workout data to Google Health.'}
          </small>
        </div>
      }>
        <div className="setting-action-controls">
          {!isConnected ? (
            <Button variant="primary" onClick={openDisclosure} disabled={loading || connecting}>
              {connecting ? 'Connecting…' : isReconnectRequired ? 'Reconnect Google Health' : 'Connect Google Health'}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => void refresh(true)}
                disabled={loading}
                aria-label="Refresh status"
              >
                <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                Refresh
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDisconnectOpen(true)}
                disabled={disconnecting}
              >
                <Unlink size={14} />
                Disconnect
              </Button>
            </>
          )}
        </div>
      </SettingRow>

      {isConnected && (
        <div className="google-health-stream">
          <h3>Workout Synchronization</h3>
          <SettingRow
            label={
              <>
                <strong>Sync completed workouts</strong>
                <small className="muted google-health-stream-status">
                  Uploads finished sessions, sets, volume, and exercise notes.
                </small>
                {state.workoutSync.pendingCount > 0 && (
                  <small className="google-health-stream-status is-pending">
                    {state.workoutSync.pendingCount} workout{state.workoutSync.pendingCount === 1 ? '' : 's'} queued for upload
                  </small>
                )}
                {state.workoutSync.state === 'failed' && (
                  <small className="google-health-stream-status is-failed">
                    {state.workoutSync.failureMessage ?? 'Workout upload failed.'}
                  </small>
                )}
                {state.workoutSync.state === 'unknown' && (
                  <small className="google-health-stream-status is-unknown">
                    Upload status uncertain. Check Google Health before recovering.
                  </small>
                )}
              </>
            }
          >
            <div className="google-health-stream-controls">
              {(state.workoutSync.state === 'failed' || state.workoutSync.state === 'unknown') && (
                <Button variant="tertiary" onClick={handleWorkoutRecover} disabled={workoutActionLoading}>
                  Retry
                </Button>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.workoutSync.enabled}
                  onChange={event => void handleWorkoutSyncToggle(event.target.checked)}
                  disabled={workoutActionLoading}
                />
                <span className="muted">{state.workoutSync.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          </SettingRow>
        </div>
      )}

      {disclosureOpen && (
        <GoogleHealthDisclosure
          onClose={() => setDisclosureOpen(false)}
          onConfirm={handleStartConnect}
          syncWorkout={requestWorkoutSync}
          onSyncWorkoutChange={setRequestWorkoutSync}
          loading={connecting}
          error={actionError}
        />
      )}

      {disconnectOpen && (
        <Modal title="Disconnect Google Health?" onClose={() => setDisconnectOpen(false)}>
          <p>
            Disconnecting will stop syncing workouts.
            Any workouts already saved to Google Health will remain there.
          </p>
          <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnectConfirm} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
