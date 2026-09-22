import { useEffect, useState } from 'react';
import { Download, LogOut, MonitorSmartphone } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { api } from '../lib/api';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { SettingRow } from './ui/SettingRow';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';
import { RestAlertSettings } from './RestAlertSettings';
import './Settings.css';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallEvent | null = null;
// Keep the browser's install affordance available as well as the Settings button.
window.addEventListener('beforeinstallprompt', event => {
  installPrompt = event as InstallEvent;
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
  onDevicePreferences: (preferences: DevicePreferences) => void;
  onPreferences: (preferences: Preferences) => void;
  notify: (message: string) => void;
  onSignOut: () => Promise<void>;
  mobileStatus: MobileStatus;
  onUpdateApp: () => void;
};

export function SettingsView(props: SettingsViewProps) {
  const {
    account,
    preferences,
    devicePreferences,
    onDevicePreferences,
    onPreferences,
    notify,
    onSignOut,
    mobileStatus,
  } = props;
  const [install, setInstall] = useState(installPrompt);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(isInstalled());
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
    void api.refreshNutritionContext().catch(() => { /* Nutrition is optional and may be offline. */ });
  }, []);

  return (
    <>
      <div className="page-heading">
        <h1 data-page-heading>Settings</h1>
      </div>

      <div className="settings-layout">
        <section className="panel">
          <div className="section-heading"><h2>Preferences</h2></div>
          <SettingRow label={<strong>Appearance</strong>}>
            <Select
              name="appearance"
              label="Appearance"
              value={preferences.theme}
              onChange={value => onPreferences({ ...preferences, theme: value as Preferences['theme'] })}
              options={[{ value: 'dark', label: 'Ayu dark' }, { value: 'light', label: 'Ayu light' }]}
            />
          </SettingRow>
          <SettingRow label={<strong>Weight unit</strong>}>
            <Select
              name="weight-unit"
              label="Weight unit"
              value={preferences.unit}
              onChange={value => onPreferences({ ...preferences, unit: value as Preferences['unit'] })}
              options={[{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }]}
            />
          </SettingRow>
        </section>

        <RestAlertSettings
          accountId={account.id}
          preferences={preferences}
          devicePreferences={devicePreferences}
          onDevicePreferences={onDevicePreferences}
          onPreferences={onPreferences}
          notify={notify}
        />

        <ConnectedApps />
        <GoogleHealthSettings />

        <section className="panel">
          <div className="section-heading"><h2>Your account</h2></div>
          <SettingRow
            className="setting-row-stacked"
            label={<strong>{account.displayName}</strong>}
            info={{ content: 'Signed in. Your training is available on every device you sign in on.', label: 'Account synchronization info' }}
          >
            <div className="setting-action-controls">
              <Button
                variant="destructive"
                onClick={async () => {
                  if (deviceId) {
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
          </SettingRow>
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
            <p>Use the install icon in Chrome or Edge&apos;s address bar.</p>
          </div>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => setHelp(false)}>Got it</Button>
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
