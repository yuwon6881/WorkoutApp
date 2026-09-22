import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { Preferences } from '../types';
import { api } from '../lib/api';
import { requestRestAlerts, testAlarmSound } from '../lib/restTimer';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId, registerWorkoutPushDevice } from '../lib/push/firebaseMessaging';
import { isFirebasePushConfigured } from '../lib/push/firebaseConfig';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { SettingRow } from './ui/SettingRow';

type PushStatus = {
  configured: boolean;
  registered: boolean;
  currentGeneration: string | null;
  message: string;
};

const ON_OFF = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
];

export function RestAlertSettings({ accountId, preferences, devicePreferences, onPreferences, onDevicePreferences, notify }: {
  accountId: string;
  preferences: Preferences;
  devicePreferences: DevicePreferences;
  onPreferences: (p: Preferences) => void;
  onDevicePreferences: (p: DevicePreferences) => void;
  notify: (message: string) => void;
}) {
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const deviceId = getWorkoutPushDeviceId();

  useEffect(() => {
    if (!deviceId) return;
    let current = true;
    void api.restAlertStatus(deviceId).then(status => { if (current) setPushStatus(status); })
      .catch(() => { if (current) setPushStatus(null); });
    return () => { current = false; };
  }, [accountId, deviceId]);

  const closedAppAlertInfo = pushStatus?.message ?? (isFirebasePushConfigured()
    ? 'Checking server and browser push availability.'
    : 'Push delivery is not configured for this Workout build yet. The foreground timer remains available.');

  async function disableOnThisDevice() {
    if (!deviceId || !pushStatus) return;
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
  }

  async function enableOnThisDevice() {
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
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Rest timer &amp; alerts</h2>
      </div>

      <SettingRow
        label={<strong>Rest notifications</strong>}
        info={{
          content: 'Local sound and the on-screen timer work without push. Closed-app alerts need this device set up and may be delayed or blocked by Focus, battery settings, or the browser.',
          label: 'Rest notifications info'
        }}
      >
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
          options={ON_OFF}
        />
      </SettingRow>

      <SettingRow
        className="setting-row-stacked"
        label={<strong>Rest sound</strong>}
        info={{
          content: 'Plays a soothing chime when your rest interval completes while Workout is open. Background alert sounds follow phone and browser settings.',
          label: 'Rest sound info'
        }}
      >
        <div className="setting-sound-controls">
          <Select
            name="rest-sound"
            label="Rest sound"
            value={devicePreferences.sound ? 'on' : 'off'}
            onChange={value => onDevicePreferences({ ...devicePreferences, sound: value === 'on' })}
            options={ON_OFF}
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
      </SettingRow>

      <SettingRow
        className="setting-row-stacked"
        label={<strong>Closed-app rest alerts</strong>}
        info={{ content: closedAppAlertInfo, label: 'Closed-app rest alerts info' }}
      >
        <div className="setting-action-controls">
          {pushStatus?.registered ? (
            <Button variant="secondary" disabled={pushBusy} onClick={() => void disableOnThisDevice()}>
              Disable on this device
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={pushBusy || !deviceId || !pushStatus?.configured || !isFirebasePushConfigured()}
              onClick={() => void enableOnThisDevice()}
            >
              {pushBusy ? 'Setting up…' : 'Enable on this device'}
            </Button>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label={<strong>Vibration</strong>}
        info={{
          content: 'Uses device vibration only where the browser and device hardware support it.',
          label: 'Vibration info'
        }}
      >
        <Select
          name="rest-vibration"
          label="Vibration"
          value={devicePreferences.vibration ? 'on' : 'off'}
          onChange={value => onDevicePreferences({ ...devicePreferences, vibration: value === 'on' })}
          options={ON_OFF}
        />
      </SettingRow>

      <SettingRow
        label={<strong>Keep screen awake during a workout</strong>}
        info={{
          content: 'Available while the workout is open and visible; the phone may still release it on low battery.',
          label: 'Keep screen awake info'
        }}
      >
        <Select
          name="workout-wake-lock"
          label="Keep screen awake during a workout"
          value={devicePreferences.keepAwake ? 'on' : 'off'}
          onChange={value => onDevicePreferences({ ...devicePreferences, keepAwake: value === 'on' })}
          options={ON_OFF}
        />
      </SettingRow>
    </section>
  );
}
