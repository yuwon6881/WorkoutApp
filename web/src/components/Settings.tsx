import { NativeBuildInfo } from './NativeBuildInfo';
import { Dumbbell, Link2, LogOut, Moon, SlidersHorizontal, Sun, Timer, Watch, Weight } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { useState } from 'react';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { SegmentedControl } from './ui/SegmentedControl';
import { SettingRow } from './ui/SettingRow';
import { Switch } from './ui/Switch';
import { tracksRir } from '../lib/trackRir';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';
import { RestAlertSettings } from './RestAlertSettings';
import { WatchPairingSettings } from './WatchPairingSettings';
import { WorkoutFlowSettings } from './WorkoutFlowSettings';
import { LoadIncrementSettings } from './LoadIncrementSettings';
import { SettingsNav, SettingsSection, type SettingsSectionLink } from './SettingsLayout';
import './Settings.css';

type SettingsViewProps = {
  account: Account;
  preferences: Preferences;
  devicePreferences: DevicePreferences;
  onDevicePreferences: (preferences: DevicePreferences) => void | Promise<void>;
  onPreferences: (preferences: Preferences) => void | Promise<void>;
  notify: (message: string) => void;
  onSignOut: () => Promise<void>;
  version: string;
  onCatalogChanged?: () => void | Promise<void>;
  preferencePending?: boolean;
  onRetryPreferences?: () => Promise<void>;
  onRevertPreferences?: () => void;
};

const sections: SettingsSectionLink[] = [
  { id: 'settings-general', label: 'General', icon: SlidersHorizontal },
  { id: 'settings-training', label: 'Training', icon: Dumbbell },
  { id: 'settings-weights', label: 'Weight increments', icon: Weight },
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
  const { account, preferences, devicePreferences, onDevicePreferences, onPreferences, notify, onSignOut, version, onCatalogChanged } = props;
  const [saveError, setSaveError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [general, training, weights, rest, watch, connections] = sections;

  async function signOut() {
    setSigningOut(true);
    try { await onSignOut(); }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'Could not sign out. Try again.'); }
    finally { setSigningOut(false); }
  }

  async function save(next: Preferences) {
    setSaveError('');
    try { await onPreferences(next); return true; }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'Preferences were not saved.'); return false; }
  }
  async function saveDevice(next: DevicePreferences) {
    try { await onDevicePreferences(next); }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'Device preferences were not saved.'); }
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
        <Button variant="secondary" className="account-signout-btn" disabled={signingOut} onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </Button>
      </section>

      {saveError && <div><CardFeedback message={saveError} />
        {props.preferencePending && <div className="modal-actions">
          <Button onClick={() => void props.onRetryPreferences?.().then(() => setSaveError('')).catch(failure => setSaveError(failure instanceof Error ? failure.message : 'Could not save preferences.'))}>Retry save</Button>
          <Button onClick={() => { props.onRevertPreferences?.(); setSaveError(''); }}>Revert preferences</Button>
        </div>}
      </div>}

      <div className="settings-shell">
        <SettingsNav links={sections} />
        <div className="settings-sections">
          <SettingsSection {...general} title="General" description="Applies to all devices.">
            <SettingRow label={<strong>Appearance</strong>} description="Color theme.">
              <SegmentedControl
                label="Appearance"
                value={preferences.theme}
                onChange={theme => void save({ ...preferences, theme })}
                options={[
                  { value: 'dark', label: <><Moon size={15} aria-hidden="true" />Dark</> },
                  { value: 'light', label: <><Sun size={15} aria-hidden="true" />Light</> }
                ]}
              />
            </SettingRow>
            <SettingRow label={<strong>Weight unit</strong>} description="Stored in kg, converted for display.">
              <SegmentedControl
                label="Weight unit"
                value={preferences.unit}
                onChange={async unit => {
                  // Exercise steps are resolved in the saved unit, so refresh them only once the
                  // server has it; refreshing sooner reads the old unit back over the new choice.
                  if (await save({ ...preferences, unit })) await onCatalogChanged?.();
                }}
                options={[
                  { value: 'kg', label: 'kg', ariaLabel: 'Kilograms (kg)' },
                  { value: 'lb', label: 'lb', ariaLabel: 'Pounds (lb)' }
                ]}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection {...training} title="Training" description="How workouts are tracked and move between exercises.">
            <SettingRow
              label={<strong>Track reps in reserve (RIR)</strong>}
              description="Hide RIR in programs, imports and workouts on every device. Existing targets are kept."
              descriptionId="track-rir-description"
            >
              <Switch
                label="Track reps in reserve (RIR)"
                describedBy="track-rir-description"
                checked={tracksRir(preferences)}
                onChange={trackRir => void save({ ...preferences, trackRir })}
              />
            </SettingRow>
            <WorkoutFlowSettings devicePreferences={devicePreferences} onDevicePreferences={saveDevice} />
          </SettingsSection>

          <SettingsSection {...weights} layout="plain" title="Weight increments" description="The weights your equipment offers, used for suggestions.">
            <LoadIncrementSettings unit={preferences.unit} notify={notify} onChanged={onCatalogChanged} />
          </SettingsSection>

          <SettingsSection {...rest} title="Rest timer & alerts" description="Timer and notification preferences.">
            <RestAlertSettings
              accountId={account.id}
              preferences={preferences}
              devicePreferences={devicePreferences}
              onDevicePreferences={saveDevice}
              onPreferences={async next => { if (!(await save(next))) throw new Error('Rest alert preferences were not saved. Retry in Settings.'); }}
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
          <NativeBuildInfo />
        </div>
      </div>
    </div>
  );
}
