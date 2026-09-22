import { useEffect, useState } from 'react';
import { Download, LogOut, MonitorSmartphone, RefreshCw, Volume2 } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { api } from '../lib/api';
import { requestRestAlerts, testAlarmSound } from '../lib/restTimer';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId, registerWorkoutPushDevice } from '../lib/push/firebaseMessaging';
import { isFirebasePushConfigured } from '../lib/push/firebaseConfig';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { InfoTooltip } from './ui/InfoTooltip';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';
import './Settings.css';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallEvent | null = null;
// The event is kept so Settings can offer its own Install button, but it is deliberately not
// cancelled: suppressing the browser's own install affordance only logs a console notice and
// takes away the more discoverable path.
window.addEventListener('beforeinstallprompt', e => {
  installPrompt = e as InstallEvent;
  window.dispatchEvent(new Event('workout-install-ready'));
});

type MobileStatus = {
  version: string;
  offlineReady: boolean;
  activeWorkout: boolean;
  pendingOperations: number;
  needsReview: boolean;
  updateReady: boolean;
  canUpdate: boolean;
};

type SettingsViewProps = {
  account: Account;
  preferences: Preferences;
  devicePreferences: DevicePreferences;
  onDevicePreferences: (p: DevicePreferences) => void;
  onPreferences: (p: Preferences) => void;
  notify: (message: string) => void;
  onSignOut: () => Promise<void>;
  mobileStatus: MobileStatus;
  onUpdateApp: () => void;
};

export function SettingsView({
  account,
  preferences,
  devicePreferences,
  onDevicePreferences,
  onPreferences,
  notify,
  onSignOut,
  mobileStatus,
  onUpdateApp
}: SettingsViewProps) {
  const [install, setInstall] = useState(installPrompt);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(isInstalled());
  const [pushStatus, setPushStatus] = useState<{
    configured: boolean;
    registered: boolean;
    currentGeneration: string | null;
    message: string;
  } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const deviceId = getWorkoutPushDeviceId();

  useEffect(() => {
    const update = () => setInstall(installPrompt);
    window.addEventListener('workout-install-ready', update);
    return () => window.removeEventListener('workout-install-ready', update);
  }, []);

  useEffect(() => {
    const markInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', markInstalled);
    return () => window.removeEventListener('appinstalled', markInstalled);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let current = true;
    void api.restAlertStatus(deviceId).then(status => { if (current) setPushStatus(status); })
      .catch(() => { if (current) setPushStatus(null); });
    return () => { current = false; };
  }, [account.id, deviceId]);

  useEffect(() => {
    void api.refreshNutritionContext().catch(() => { /* Nutrition is optional and may be offline. */ });
  }, []);

  const closedAppAlertInfo = pushStatus?.message ?? (isFirebasePushConfigured()
    ? 'Checking server and browser push availability.'
    : 'Push delivery is not configured for this Workout build yet. The foreground timer remains available.');

  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>

      <div className="settings-layout settings-grid">
        {mobileStatus.updateReady && (
          <div className="app-update-banner" role="status">
            <div className="app-update-info">
              <strong>App update ready</strong>
              <small>
                {mobileStatus.canUpdate
                  ? 'A new version of Workout is ready to install.'
                  : 'Finish the open workout and sync pending changes before installing.'}
              </small>
            </div>
            <Button
              variant="primary"
              disabled={!mobileStatus.canUpdate}
              onClick={onUpdateApp}
            >
              <RefreshCw size={15} /> Update Workout
            </Button>
          </div>
        )}

        <section className="panel">
          <div className="settings-panel-header">
            <h2>Preferences</h2>
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Appearance</strong>
            </span>
            <Select
              name="appearance"
              label="Appearance"
              value={preferences.theme}
              onChange={val => onPreferences({ ...preferences, theme: val as Preferences['theme'] })}
              options={[
                { value: 'dark', label: 'Ayu dark' },
                { value: 'light', label: 'Ayu light' }
              ]}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Weight unit</strong>
            </span>
            <Select
              name="weight-unit"
              label="Weight unit"
              value={preferences.unit}
              onChange={val => onPreferences({ ...preferences, unit: val as Preferences['unit'] })}
              options={[
                { value: 'kg', label: 'Kilograms (kg)' },
                { value: 'lb', label: 'Pounds (lb)' }
              ]}
            />
          </div>
        </section>

        <section className="panel">
          <div className="settings-panel-header">
            <h2>Rest timer & alerts</h2>
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Rest notifications</strong>
              <InfoTooltip
                content="Local sound and the on-screen timer work without push. Closed-app alerts need this device set up and may be delayed or blocked by Focus, battery settings, or the browser."
                label="Rest notifications info"
              />
            </span>
            <Select
              name="rest-alerts"
              label="Rest notifications"
              value={preferences.restAlerts ? 'on' : 'off'}
              onChange={async val => {
                const wanted = val === 'on';
                if (wanted && (await requestRestAlerts()) !== 'granted') {
                  notify('Workout notifications are not enabled. You can still use the on-screen timer and sound.');
                }
                onPreferences({ ...preferences, restAlerts: wanted });
              }}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' }
              ]}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Rest sound</strong>
              <InfoTooltip
                content="Plays a soothing chime when your rest interval completes while Workout is open. Background alert sounds follow phone and browser settings."
                label="Rest sound info"
              />
            </span>
            <div className="setting-sound-controls">
              <Select
                name="rest-sound"
                label="Rest sound"
                value={devicePreferences.sound ? 'on' : 'off'}
                onChange={value => onDevicePreferences({ ...devicePreferences, sound: value === 'on' })}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' }
                ]}
              />
              <Button
                variant="secondary"
                onClick={() =>
                  notify(
                    testAlarmSound()
                      ? 'Sound test played.'
                      : 'This browser could not start audio. Tap Test sound again or check device volume.'
                  )
                }
              >
                <Volume2 size={15} /> Test sound
              </Button>
            </div>
          </div>
          <div className="setting-row setting-action-row">
            <div className="setting-action-info">
              <strong>Closed-app rest alerts</strong>
              <InfoTooltip
                content={closedAppAlertInfo}
                label="Closed-app rest alerts info"
              />
            </div>
            <div className="setting-action-controls">
              {pushStatus?.registered ? (
                <Button
                  variant="secondary"
                  disabled={pushBusy}
                  onClick={async () => {
                    if (!deviceId) return;
                    setPushBusy(true);
                    try {
                      await api.unregisterRestAlertDevice(deviceId);
                      setPushStatus({
                        ...pushStatus,
                        registered: false,
                        currentGeneration: null,
                        message: 'Closed-app rest alerts are disabled on this device.'
                      });
                      await deleteWorkoutPushToken();
                      window.dispatchEvent(new Event('workout-rest-push-changed'));
                      notify('Closed-app rest alerts are disabled on this device.');
                    } catch (failure) {
                      notify(failure instanceof Error ? failure.message : 'Could not disable device notifications.');
                    } finally {
                      setPushBusy(false);
                    }
                  }}
                >
                  Disable on this device
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={pushBusy || !deviceId || !pushStatus?.configured || !isFirebasePushConfigured()}
                  onClick={async () => {
                    setPushBusy(true);
                    try {
                      const permission = await requestRestAlerts();
                      if (permission !== 'granted') {
                        notify('Allow notifications in your browser settings to enable closed-app rest alerts.');
                        return;
                      }
                      const registration = await registerWorkoutPushDevice();
                      const status = await api.registerRestAlertDevice(registration.deviceId, registration.token);
                      setPushStatus(status);
                      window.dispatchEvent(new Event('workout-rest-push-changed'));
                      if (!preferences.restAlerts) onPreferences({ ...preferences, restAlerts: true });
                      notify('This device is set up for private rest alerts. Delivery depends on browser and phone notification settings.');
                    } catch (failure) {
                      notify(failure instanceof Error ? failure.message : 'Could not enable notifications on this device.');
                    } finally {
                      setPushBusy(false);
                    }
                  }}
                >
                  {pushBusy ? 'Setting up…' : 'Enable on this device'}
                </Button>
              )}
            </div>
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Vibration</strong>
              <InfoTooltip
                content="Uses device vibration only where the browser and device hardware support it."
                label="Vibration info"
              />
            </span>
            <Select
              name="rest-vibration"
              label="Vibration"
              value={devicePreferences.vibration ? 'on' : 'off'}
              onChange={value => onDevicePreferences({ ...devicePreferences, vibration: value === 'on' })}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' }
              ]}
            />
          </div>
          <div className="setting-row">
            <span className="setting-label-wrap">
              <strong>Keep screen awake during a workout</strong>
              <InfoTooltip
                content="Available while the workout is open and visible; the phone may still release it on low battery."
                label="Keep screen awake info"
              />
            </span>
            <Select
              name="workout-wake-lock"
              label="Keep screen awake during a workout"
              value={devicePreferences.keepAwake ? 'on' : 'off'}
              onChange={value => onDevicePreferences({ ...devicePreferences, keepAwake: value === 'on' })}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' }
              ]}
            />
          </div>
        </section>

        <ConnectedApps />
        <GoogleHealthSettings />

        <section className="panel">
          <div className="settings-panel-header">
            <h2>Your account</h2>
          </div>
          <div className="setting-row setting-action-row">
            <div className="setting-action-info">
              <strong>{account.displayName}</strong>
              <InfoTooltip
                content="Signed in. Your training is available on every device you sign in on."
                label="Account synchronization info"
              />
            </div>
            <div className="setting-action-controls">
              <Button
                variant="destructive"
                onClick={async () => {
                  if (deviceId && pushStatus?.registered) {
                    try {
                      await api.unregisterRestAlertDevice(deviceId);
                      await deleteWorkoutPushToken();
                    } catch {
                      notify('Device push registration may not have been revoked yet. Any queued rest alert expires shortly.');
                    }
                  }
                  await onSignOut();
                }}
              >
                <LogOut size={16} /> Sign out
              </Button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="install-panel-content">
            <div className="install-panel-info">
              <h2>
                <MonitorSmartphone size={22} className="accent" />
                Install Workout
              </h2>
              <p>
                {installed
                  ? 'Workout is installed on this device. Starting a workout needs a connection; set logging, pause/resume, and finishing can sync when you return online.'
                  : 'Install Workout on your home screen for the best phone experience. Starting a workout needs a connection; set logging, pause/resume, and finishing can be saved on this device and synced when you return online.'}
              </p>
            </div>
            <Button
              variant="primary"
              disabled={installed}
              onClick={async () => {
                if (install) {
                  try {
                    await install.prompt();
                    await install.userChoice;
                    setInstall(null);
                    installPrompt = null;
                  } catch {
                    setHelp(true);
                  }
                } else {
                  setHelp(true);
                }
              }}
            >
              <Download size={17} /> Install app
            </Button>
          </div>
        </section>

        <div className="app-version-meta">
          <span>Workout version {mobileStatus.version}</span>
        </div>
      </div>

      {help && (
        <Modal title="Install Workout" onClose={() => setHelp(false)}>
          <div className="modal-body">
            <h3>iPhone or iPad</h3>
            <p>Open this site in Safari. Tap Share, then Add to Home Screen. On iOS, turn on Open as Web App before adding it.</p>
            <h3>Android</h3>
            <p>Open this site in Chrome. Tap the three-dot menu, then Install app or Add to Home screen.</p>
            <h3>Desktop</h3>
            <p>Use the install icon in Chrome or Edge’s address bar.</p>
          </div>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => setHelp(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
