import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { Switch } from './ui/Switch';
import {
  recoverGoogleHealthWorkoutSync,
  setGoogleHealthWorkoutSync,
  useGoogleHealth,
} from '../lib/googleHealth';
import { describeWorkoutUploadFailure } from '../lib/googleHealthFailure';
import { GoogleHealthDisclosure } from './GoogleHealthDisclosure';
import { Activity, RefreshCw, Unlink } from 'lucide-react';
import './IntegrationCard.css';
import { GOOGLE_HEALTH_HANDOFF_EVENT, startGoogleHealthHandoff, type GoogleHealthHandoffOutcome } from '../lib/googleHealthBrowser';
import { describeGoogleHealthConnectError } from '../lib/googleHealthConnectError';

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
    setRequestWorkoutSync(state.status === 'connected' && state.workoutSync.permissionGranted ? state.workoutSync.enabled : true);
    setDisclosureOpen(true);
  };

  // The browser callback reports its result in the address; the Android handoff reports it by event.
  useEffect(() => {
    const show = (connected: boolean, code: string | null) => {
      setActionError('');
      setBannerNotice(connected
        ? { type: 'success', message: 'Google Health connected successfully.' }
        : { type: 'error', message: describeGoogleHealthConnectError(code) });
      if (connected) void refresh(true);
    };

    const params = new URLSearchParams(window.location.search);
    const ghResult = params.get('google_health');
    if (ghResult === 'connected' || ghResult === 'error') {
      show(ghResult === 'connected', params.get('code'));
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    }

    const handoff = (event: Event) => {
      const outcome = (event as CustomEvent<GoogleHealthHandoffOutcome>).detail;
      if (outcome.status === 'connected') show(true, null);
      else if (outcome.status === 'error') show(false, outcome.code);
    };
    window.addEventListener(GOOGLE_HEALTH_HANDOFF_EVENT, handoff);
    return () => window.removeEventListener(GOOGLE_HEALTH_HANDOFF_EVENT, handoff);
  }, [refresh]);

  const handleStartConnect = async () => {
    setConnecting(true);
    setActionError('');
    try {
      // In the Android app consent runs in a Custom Tab; the handoff event reports how it ended.
      if (await startGoogleHealthHandoff(requestWorkoutSync)) {
        setDisclosureOpen(false);
        setConnecting(false);
        return;
      }
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
      await refresh(true);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to recover workout synchronization.');
    } finally {
      setWorkoutActionLoading(false);
    }
  };

  const isConnected = state.status === 'connected';
  const isReconnectRequired = state.status === 'reconnect_required';

  const sync = state.workoutSync;
  const uploadFailure = describeWorkoutUploadFailure(sync);
  const statusLabel = isConnected ? 'Connected' : isReconnectRequired ? 'Reconnect required' : loading ? 'Checking…' : syncError ? 'Unavailable' : 'Not connected';
  const statusTone = isConnected ? 'is-on' : isReconnectRequired ? 'is-warning' : '';

  return (
    <article className="panel integration-card" aria-labelledby="google-health-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Activity size={20} /></span>
        <div className="integration-card-title">
          <h3 id="google-health-title">Google Health</h3>
          <span>Syncs completed workouts and volume.</span>
        </div>
        <span className={`integration-status ${statusTone}`.trim()} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      {bannerNotice && <CardFeedback tone={bannerNotice.type} title={bannerNotice.type==='error'?'Connection needs attention':'Google Health connected'} message={bannerNotice.message}/>}
      {actionError && <CardFeedback title="Google Health action failed" message={actionError}/>}
      {syncError && <CardFeedback tone="warning" title="Google Health sync paused" message={syncError}
        action={{label:loading?'Updating…':'Retry sync',onClick:()=>void refresh(true),disabled:loading}}/>}
      <div className="integration-description">
        {isConnected
          ? `Connected${state.connectedAt ? ` since ${new Date(state.connectedAt).toLocaleDateString()}` : ''}. Saved workouts remain in Google Health.`
          : isReconnectRequired
            ? 'Authorization expired or permissions changed. Reconnect to resume sync.'
            : syncError ? 'Connection status could not be checked. Retry to check your existing connection.' : 'Link your Google account to export completed workouts.'}
      </div>

      {isConnected && (
        <div className="integration-stream">
          <SettingRow
            label={<strong>Sync completed workouts</strong>}
            descriptionId="google-health-sync-description"
            description={<>
              <span>Upload finished sessions and exercise notes.</span>
              {sync.pendingCount > 0 && (
                <span className="setting-status is-pending">
                  {sync.pendingCount} workout{sync.pendingCount === 1 ? '' : 's'} queued for upload
                </span>
              )}
            </>}
          >
            <div className="setting-inline-controls">
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
      {/* Beside the sync row rather than inside its panel, so a phone does not nest it three surfaces deep. */}
      {isConnected && uploadFailure && (
        <CardFeedback
          tone={uploadFailure.tone}
          title={uploadFailure.title}
          message={uploadFailure.message}
          detail={uploadFailure.detail}
          action={{
            label: workoutActionLoading && uploadFailure.action === 'retry' ? 'Retrying…' : uploadFailure.actionLabel,
            onClick: uploadFailure.action === 'reconnect' ? openDisclosure : () => void handleWorkoutRecover(),
            disabled: workoutActionLoading,
          }}
        />
      )}

      <div className="integration-actions">
        {isConnected ? (
          <>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)} disabled={disconnecting}>
              <Unlink size={14} aria-hidden="true" /> Disconnect
            </Button>
            <Button variant="secondary" onClick={() => void refresh(true)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spinning' : ''} aria-hidden="true" /> {loading?'Updating…':'Refresh status'}
            </Button>
          </>
        ) : !syncError && !loading ? (
          <Button variant="primary" onClick={openDisclosure} disabled={loading || connecting}>
            {connecting ? 'Connecting…' : isReconnectRequired ? 'Reconnect Google Health' : 'Connect Google Health'}
          </Button>
        ) : null}
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
