import { useEffect, useState } from 'react';
import { BellOff, BellRing, Volume2 } from 'lucide-react';
import type { Preferences } from '../types';
import { api } from '../lib/api';
import { requestRestAlerts, testAlarmSound } from '../lib/restTimer';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId, registerWorkoutPushDevice } from '../lib/push/firebaseMessaging';
import { isFirebasePushConfigured } from '../lib/push/firebaseConfig';
import type { DevicePreferences } from '../lib/workoutRecovery';
import { Button } from './ui/Button';
import { SettingRow } from './ui/SettingRow';
import { getAlertCapabilities, hasNativeWorkoutStore, isNative, openNativeSettings, testNativeAlert } from '../lib/platform';
import type { AlertCapabilities } from '../lib/platform';
import { Switch } from './ui/Switch';

type PushStatus = {
  configured: boolean;
  registered: boolean;
  currentGeneration: string | null;
  message: string;
};

export function RestAlertSettings({ accountId, preferences, devicePreferences, onPreferences, onDevicePreferences, notify }: {
  accountId: string;
  preferences: Preferences;
  devicePreferences: DevicePreferences;
  onPreferences: (p: Preferences) => void | Promise<void>;
  onDevicePreferences: (p: DevicePreferences) => void;
  notify: (message: string) => void;
}) {
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<AlertCapabilities | null>(null);
  const nativeAlerts = hasNativeWorkoutStore();
  const deviceId = getWorkoutPushDeviceId();

  // Permissions change in system settings, so they are read again whenever the app returns.
  useEffect(() => {
    if (!nativeAlerts) return;
    const refresh = () => { if (document.visibilityState === 'visible') void getAlertCapabilities().then(setCapabilities); };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [nativeAlerts]);

  useEffect(() => {
    if (nativeAlerts) return;
    if (!deviceId) return;
    let current = true;
    void api.restAlertStatus(deviceId).then(status => { if (current) setPushStatus(status); })
      .catch(() => { if (current) setPushStatus(null); });
    return () => { current = false; };
  }, [accountId, deviceId, nativeAlerts]);

  const closedAppAlertInfo = pushStatus?.message ?? (isFirebasePushConfigured()
    ? 'Checking push availability…'
    : 'Push delivery is not configured for this build.');

  async function disableOnThisDevice() {
    if (!deviceId || !pushStatus) return;
    setPushBusy(true);
    try {
      await api.unregisterRestAlertDevice(deviceId);
      setPushStatus({
        ...pushStatus,
        registered: false,
        currentGeneration: null,
        message: 'Disabled on this device.'
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
      // The Android app schedules its own local notification for each rest, so it needs only the
      // permission, not a registered push device.
      if (isNative()) {
        if (!preferences.restAlerts) await onPreferences({ ...preferences, restAlerts: true });
        notify('Rest notifications are enabled. Delivery depends on Android notification settings.');
        return;
      }
      const registration = await registerWorkoutPushDevice();
      const status = await api.registerRestAlertDevice(registration.deviceId, registration.token);
      setPushStatus(status);
      window.dispatchEvent(new Event('workout-rest-push-changed'));
      if (!preferences.restAlerts) await onPreferences({ ...preferences, restAlerts: true });
      notify('This device is set up for private rest alerts. Delivery depends on browser and phone notification settings.');
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Could not enable notifications on this device.');
    } finally {
      setPushBusy(false);
    }
  }

  const pushSetUp = Boolean(pushStatus?.registered);

  if (nativeAlerts) {
    return (
      <>
        <SettingRow
          label={<strong>Rest notifications</strong>}
          description="Alert when a rest ends, with the countdown on the lock screen."
          descriptionId="rest-alerts-description"
        >
          <Switch
            label="Rest notifications"
            describedBy="rest-alerts-description"
            checked={preferences.restAlerts}
            onChange={async wanted => {
              const allowed = !wanted || (await requestRestAlerts()) === 'granted';
              if (!allowed) {
                notify('Workout notifications are not enabled. You can still use the on-screen timer and sound.');
              }
              try { await onPreferences({ ...preferences, restAlerts: wanted && allowed }); }
              catch (failure) { notify(failure instanceof Error ? failure.message : 'Rest alert preferences were not saved.'); }
              void getAlertCapabilities().then(setCapabilities);
            }}
          />
        </SettingRow>

        <SettingRow
          label={<strong>Workout alerts on this phone</strong>}
          description={<>
            <span className={`setting-status ${capabilities?.notifications ? 'is-on' : ''}`}>
              <span className="status-dot" aria-hidden="true" />
              {!capabilities ? 'Checking…' : capabilities.notifications ? 'Notifications allowed' : 'Notifications are off'}
            </span>
            {capabilities && <span>{capabilities.exactAlarm
              ? 'Precise timing allowed.'
              : 'Precise timing is off, so an alert can arrive late while the phone sleeps.'}</span>}
            {capabilities?.notifications && capabilities.restChannelEnabled === false &&
              <span role="status">The rest notification channel is off.</span>}
            {capabilities?.restChannelEnabled && capabilities.restSoundEnabled === false && devicePreferences.sound &&
              <span role="status">Rest sound is muted in Android channel settings.</span>}
            {capabilities?.notifications && capabilities.liveUpdatesSupported && !capabilities.liveUpdates &&
              <span>Live Updates are off, so the rest countdown is not pinned to the status bar.</span>}
            {capabilities?.notifications && capabilities.xiaomiIsland === 'off' &&
              <span>Super Island is off for this app. Allow focus notifications in HyperOS notification settings.</span>}
            {capabilities?.serviceError && <span role="alert">{capabilities.serviceError}</span>}
          </>}
          info={{
            content: 'Alerts need notifications and precise timing. Scheduling an alert does not prove it arrives: use Test alert with the screen locked. Force stop, Do Not Disturb, and a muted phone can still silence it.',
            label: 'Workout alerts info'
          }}
        >
          <div className="setting-inline-controls">
            {capabilities && (capabilities.restChannelEnabled === false || capabilities.restSoundEnabled === false) && (
              <Button variant="secondary" onClick={() => void openNativeSettings('rest_channel').catch(() => notify('Could not open rest notification settings.'))}>
                Rest channel settings
              </Button>
            )}
            {capabilities && (!capabilities.notifications || capabilities.xiaomiIsland === 'off' ||
              (capabilities.liveUpdatesSupported && !capabilities.liveUpdates)) && (
              <Button variant="secondary" onClick={() => void openNativeSettings('notifications').catch(() => notify('Could not open notification settings.'))}>
                Notification settings
              </Button>
            )}
            {capabilities && !capabilities.exactAlarm && (
              <Button variant="secondary" onClick={() => void openNativeSettings('exact_alarm').catch(() => notify('Could not open alarm settings.'))}>
                Alarm settings
              </Button>
            )}
            <Button
              variant="tertiary"
              onClick={async () => {
                try {
                  await testNativeAlert(devicePreferences.sound, devicePreferences.vibration);
                  notify('A test alert is scheduled in 5 seconds. Lock the screen to check delivery.');
                } catch (failure) {
                  notify(failure instanceof Error ? failure.message : 'Could not schedule a test alert.');
                }
              }}
            >
              Test alert
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label={<strong>Rest sound</strong>}
          description="Two-note chime when rest ends."
          descriptionId="rest-sound-description"
        >
          <div className="setting-inline-controls">
            <Button
              variant="tertiary"
              onClick={() =>
                notify(
                  testAlarmSound()
                    ? 'Sound test played.'
                    : 'Could not play sound. Check device media/alarm volume.'
                )
              }
            >
              <Volume2 size={15} aria-hidden="true" /> Test sound
            </Button>
            <Switch
              label="Rest sound"
              describedBy="rest-sound-description"
              checked={devicePreferences.sound}
              onChange={sound => onDevicePreferences({ ...devicePreferences, sound })}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={<strong>Vibration</strong>}
          description="Vibrate on rest end and logged sets."
          descriptionId="rest-vibration-description"
        >
          <Switch
            label="Vibration"
            describedBy="rest-vibration-description"
            checked={devicePreferences.vibration}
            onChange={vibration => onDevicePreferences({ ...devicePreferences, vibration })}
          />
        </SettingRow>

        <SettingRow
          label={<strong>Keep screen awake during a workout</strong>}
          description="Keep display on while training."
          descriptionId="rest-wake-description"
        >
          <Switch
            label="Keep screen awake during a workout"
            describedBy="rest-wake-description"
            checked={devicePreferences.keepAwake}
            onChange={keepAwake => onDevicePreferences({ ...devicePreferences, keepAwake })}
          />
        </SettingRow>
      </>
    );
  }

  return (
    <>
      <SettingRow
        label={<strong>Rest notifications</strong>}
        description="Alert when a rest interval ends."
        descriptionId="rest-alerts-description"
      >
        <Switch
          label="Rest notifications"
          describedBy="rest-alerts-description"
          checked={preferences.restAlerts}
          onChange={async wanted => {
            if (wanted && (await requestRestAlerts()) !== 'granted') {
              notify('Workout notifications are not enabled. You can still use the on-screen timer and sound.');
            }
            onPreferences({ ...preferences, restAlerts: wanted });
          }}
        />
      </SettingRow>

      <SettingRow
        label={<strong>Closed-app rest alerts</strong>}
        description={<>
          <span className={`setting-status ${pushSetUp ? 'is-on' : ''}`}>
            <span className="status-dot" aria-hidden="true" />
            {pushSetUp ? 'Set up on this device' : 'Not set up on this device'}
          </span>
          <span>{closedAppAlertInfo}</span>
        </>}
        info={{
          content: 'Closed-app alerts may be delayed or blocked by Focus, battery settings, or the browser.',
          label: 'Closed-app rest alerts info'
        }}
      >
        {pushSetUp ? (
          <Button variant="secondary" disabled={pushBusy} onClick={() => void disableOnThisDevice()}>
            <BellOff size={15} aria-hidden="true" /> Disable on this device
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={pushBusy || !deviceId || !pushStatus?.configured || !isFirebasePushConfigured()}
            onClick={() => void enableOnThisDevice()}
          >
            <BellRing size={15} aria-hidden="true" /> {pushBusy ? 'Setting up…' : 'Enable on this device'}
          </Button>
        )}
      </SettingRow>

      <SettingRow
        label={<strong>Rest sound</strong>}
        description="Chime when rest ends while app is open."
        descriptionId="rest-sound-description"
      >
        <div className="setting-inline-controls">
          <Button
            variant="tertiary"
            onClick={() =>
              notify(
                testAlarmSound()
                  ? 'Sound test played.'
                  : 'This browser could not start audio. Tap Test sound again or check device volume.'
              )
            }
          >
            <Volume2 size={15} aria-hidden="true" /> Test sound
          </Button>
          <Switch
            label="Rest sound"
            describedBy="rest-sound-description"
            checked={devicePreferences.sound}
            onChange={sound => onDevicePreferences({ ...devicePreferences, sound })}
          />
        </div>
      </SettingRow>

      <SettingRow
        label={<strong>Vibration</strong>}
        description="Vibrate on rest end and logged sets."
        descriptionId="rest-vibration-description"
      >
        <Switch
          label="Vibration"
          describedBy="rest-vibration-description"
          checked={devicePreferences.vibration}
          onChange={vibration => onDevicePreferences({ ...devicePreferences, vibration })}
        />
      </SettingRow>

      <SettingRow
        label={<strong>Keep screen awake during a workout</strong>}
        description="Keep display on while training."
        descriptionId="rest-wake-description"
      >
        <Switch
          label="Keep screen awake during a workout"
          describedBy="rest-wake-description"
          checked={devicePreferences.keepAwake}
          onChange={keepAwake => onDevicePreferences({ ...devicePreferences, keepAwake })}
        />
      </SettingRow>
    </>
  );
}
