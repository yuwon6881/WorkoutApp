import { useEffect } from 'react';
import { Link2, LogOut, Moon, SlidersHorizontal, Sun, Timer, Watch } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { api } from '../lib/api';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { SettingRow } from './ui/SettingRow';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';
import { RestAlertSettings } from './RestAlertSettings';
import { WatchPairingSettings } from './WatchPairingSettings';
import { SettingsNav, SettingsSection, type SettingsSectionLink } from './SettingsLayout';
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

const sections: SettingsSectionLink[] = [
  { id: 'settings-general', label: 'General', icon: SlidersHorizontal },
  { id: 'settings-rest', label: 'Rest timer', icon: Timer },
  { id: 'settings-watch', label: 'Wear OS', icon: Watch },
  { id: 'settings-connections', label: 'Connected apps', icon: Link2 }
];

function initials(name: string) {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase() || '?';
}

export function SettingsView(props: SettingsViewProps) {
  const { account, preferences, devicePreferences, onDevicePreferences, onPreferences, notify, onSignOut, version } = props;
  const deviceId = getWorkoutPushDeviceId();
  const [general, rest, watch, connections] = sections;

  useEffect(() => {
    void api.refreshNutritionContext().catch(() => { /* Nutrition is optional and may be offline. */ });
  }, []);

  async function signOut() {
    if (deviceId) {
      try {
        await api.unregisterRestAlertDevice(deviceId);
        await deleteWorkoutPushToken();
      } catch {
        notify('Device push registration may not have been revoked yet. Any queued rest alert expires shortly.');
      }
    }
    await onSignOut();
  }

  return (
    <div className="settings-page">
      <div className="page-heading">
        <h1 data-page-heading>Settings</h1>
      </div>

      <section className="panel settings-account" aria-labelledby="settings-account-title">
        <span className="settings-avatar" aria-hidden="true">{initials(account.displayName)}</span>
        <div className="settings-account-copy">
          <span className="settings-account-kicker">Fitness Account</span>
          <h2 id="settings-account-title" className="settings-account-name">{account.displayName}</h2>
          <span className="settings-account-note">Synced across your devices.</span>
        </div>
        <Button variant="secondary" className="account-signout-btn" onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </Button>
      </section>

      <div className="settings-shell">
        <SettingsNav links={sections} />
        <div className="settings-sections">
          <SettingsSection {...general} title="General" description="Applies to all devices.">
            <SettingRow label={<strong>Appearance</strong>} description="Ayu theme palette.">
              <SegmentedControl
                label="Appearance"
                value={preferences.theme}
                onChange={theme => onPreferences({ ...preferences, theme })}
                options={[
                  { value: 'dark', label: <><Moon size={15} aria-hidden="true" />Ayu dark</> },
                  { value: 'light', label: <><Sun size={15} aria-hidden="true" />Ayu light</> }
                ]}
              />
            </SettingRow>
            <SettingRow label={<strong>Weight unit</strong>} description="Stored in kg, converted for display.">
              <SegmentedControl
                label="Weight unit"
                value={preferences.unit}
                onChange={unit => onPreferences({ ...preferences, unit })}
                options={[
                  { value: 'kg', label: 'kg', ariaLabel: 'Kilograms (kg)' },
                  { value: 'lb', label: 'lb', ariaLabel: 'Pounds (lb)' }
                ]}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection {...rest} title="Rest timer & alerts" description="Timer and notification preferences.">
            <RestAlertSettings
              accountId={account.id}
              preferences={preferences}
              devicePreferences={devicePreferences}
              onDevicePreferences={onDevicePreferences}
              onPreferences={onPreferences}
              notify={notify}
            />
          </SettingsSection>

          <SettingsSection {...watch} title="Wear OS" description="Pair your watch companion.">
            <WatchPairingSettings accountId={account.id} notify={notify} />
          </SettingsSection>

          <SettingsSection {...connections} layout="plain" title="Connected apps" description="Data sharing with connected apps.">
            <ConnectedApps />
            <GoogleHealthSettings />
          </SettingsSection>

          <div className="app-version-meta">Workout version {version}</div>
        </div>
      </div>
    </div>
  );
}
