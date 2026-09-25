import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { Switch } from './ui/Switch';
import {
  recoverGoogleHealthWorkoutSync,
  setGoogleHealthWorkoutSync,
  useGoogleHealth,
} from '../lib/googleHealth';
import { GoogleHealthDisclosure } from './GoogleHealthDisclosure';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Unlink } from 'lucide-react';
import './IntegrationCard.css';

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

  const sync = state.workoutSync;
  const statusLabel = isConnected ? 'Connected' : isReconnectRequired ? 'Reconnect required' : 'Not connected';
  const statusTone = isConnected ? 'is-on' : isReconnectRequired ? 'is-warning' : '';

  return (
    <article className="panel integration-card" aria-labelledby="google-health-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Activity size={20} /></span>
        <div className="integration-card-title">
          <h3 id="google-health-title">Google Health</h3>
          <span>Completed workouts, sets, and training volume.</span>
        </div>
        <span className={`integration-status ${statusTone}`.trim()} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      {bannerNotice && (
        <div className={bannerNotice.type === 'error' ? 'error-banner' : 'success-banner'} role={bannerNotice.type === 'error' ? 'alert' : 'status'}>
          {bannerNotice.type === 'error' ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
          <span>{bannerNotice.message}</span>
        </div>
      )}
      {actionError && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}
      {syncError && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{syncError}</span>
        </div>
      )}

      <div className="integration-description">
        {isConnected
          ? `Connected${state.connectedAt ? ` since ${new Date(state.connectedAt).toLocaleDateString()}` : ''}. Workouts already saved to Google Health stay there if you disconnect.`
          : isReconnectRequired
            ? 'Your Google authorization expired or permissions changed. Reconnect to resume sync.'
            : 'Link your Google account to send finished workouts to Google Health.'}
      </div>

      {isConnected && (
        <div className="integration-stream">
          <SettingRow
            label={<strong>Sync completed workouts</strong>}
            descriptionId="google-health-sync-description"
            description={<>
              <span>Uploads finished sessions, sets, volume, and exercise notes.</span>
              {sync.pendingCount > 0 && (
                <span className="setting-status is-pending">
                  {sync.pendingCount} workout{sync.pendingCount === 1 ? '' : 's'} queued for upload
                </span>
              )}
              {sync.state === 'failed' && (
                <span className="setting-status is-failed">{sync.failureMessage ?? 'Workout upload failed.'}</span>
              )}
              {sync.state === 'unknown' && (
                <span className="setting-status is-unknown">Upload status uncertain. Check Google Health before recovering.</span>
              )}
            </>}
          >
            <div className="setting-inline-controls">
              {(sync.state === 'failed' || sync.state === 'unknown') && (
                <Button variant="tertiary" onClick={() => void handleWorkoutRecover()} disabled={workoutActionLoading}>
                  Retry
                </Button>
              )}
              <Switch
                label="Sync completed workouts"
                describedBy="google-health-sync-description"
                checked={sync.enabled}
                disabled={workoutActionLoading}
                onChange={enabled => void handleWorkoutSyncToggle(enabled)}
              />
            </div>
          </SettingRow>
        </div>
      )}

      <div className="integration-actions">
        {isConnected ? (
          <>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)} disabled={disconnecting}>
              <Unlink size={14} aria-hidden="true" /> Disconnect
            </Button>
            <Button variant="secondary" onClick={() => void refresh(true)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spinning' : ''} aria-hidden="true" /> Refresh status
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={openDisclosure} disabled={loading || connecting}>
            {connecting ? 'Connecting…' : isReconnectRequired ? 'Reconnect Google Health' : 'Connect Google Health'}
          </Button>
        )}
      </div>

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
          <div className="modal-body">
            <p>Disconnecting stops syncing workouts. Workouts already saved to Google Health stay there.</p>
          </div>
          <div className="modal-actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDisconnectConfirm()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </Modal>
      )}
    </article>
  );
}
