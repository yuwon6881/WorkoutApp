import { useEffect } from 'react';
import { LogOut } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { api } from '../lib/api';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { SettingRow } from './ui/SettingRow';
import { InfoTooltip } from './ui/InfoTooltip';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';
import { RestAlertSettings } from './RestAlertSettings';
import { WatchPairingSettings } from './WatchPairingSettings';
import './Settings.css';

type SettingsViewProps = {
  account: Account;
  preferences: Preferences;
  devicePreferences: DevicePreferences;
  onDevicePreferences: (preferences: DevicePreferences) => void;
  onPreferences: (preferences: Preferences) => void;
  notify: (message: string) => void;
  onSignOut: () => Promise<void>;
  version: string;
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
    version,
  } = props;
  const deviceId = getWorkoutPushDeviceId();

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

        <WatchPairingSettings accountId={account.id} notify={notify} />

        <ConnectedApps />
        <GoogleHealthSettings />

        <section className="panel account-panel" aria-label="Your account">
          <div className="account-panel-content">
            <div className="account-panel-info">
              <span className="account-panel-kicker">Your account</span>
              <div className="account-panel-user">
                <strong>{account.displayName}</strong>
                <InfoTooltip
                  content="Signed in. Your training is available on every device you sign in on."
                  label="Account synchronization info"
                />
              </div>
            </div>
            <Button
              variant="destructive"
              className="account-signout-btn"
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
        </section>

        <div className="app-version-meta">
          <span>Workout version {version}</span>
        </div>
      </div>
    </>
  );
}
