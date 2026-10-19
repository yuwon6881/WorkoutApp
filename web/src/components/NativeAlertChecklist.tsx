import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AlertCapabilities } from '../lib/platform';
import { notificationPermission, openNativeSettings } from '../lib/platform';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import './NativeAlertChecklist.css';

type SettingsPage = 'exact_alarm' | 'notifications' | 'rest_channel';

type ChecklistItem = {
  key: string;
  label: string;
  ok: boolean;
  status: string;
  fix?: { label: string; page: SettingsPage };
};

/// What a rest alert on this phone depends on, one line each, so a missing permission is named
/// beside the button that fixes it rather than in a paragraph above a row of buttons.
export function alertChecklist(capabilities: AlertCapabilities, sound: boolean): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      key: 'notifications',
      label: 'Notifications',
      ok: capabilities.notifications,
      status: capabilities.notifications ? 'Allowed' : 'Off, so no alert can show',
      fix: { label: 'Turn on', page: 'notifications' }
    },
    {
      key: 'exact',
      label: 'Precise timing',
      ok: capabilities.exactAlarm,
      status: capabilities.exactAlarm ? 'Allowed' : 'Off, so an alert can arrive late while the phone sleeps',
      fix: { label: 'Allow', page: 'exact_alarm' }
    }
  ];
  if (!capabilities.notifications) return items;

  const channelOff = capabilities.restChannelEnabled === false;
  items.push({
    key: 'channel',
    label: 'Rest alert channel',
    ok: !channelOff,
    status: channelOff ? 'Turned off in Android' : 'On',
    fix: { label: 'Open', page: 'rest_channel' }
  });
  // The chime plays at media volume, so only Do Not Disturb holds it back. That is a phone-wide
  // choice made in quick settings, so the line names it without a button.
  if (!channelOff && capabilities.restSoundEnabled === false && sound) items.push({
    key: 'dnd',
    label: 'Do Not Disturb',
    ok: false,
    status: 'On, so the rest chime is held back'
  });
  if (capabilities.liveUpdatesSupported) items.push({
    key: 'live',
    label: 'Live Updates',
    ok: capabilities.liveUpdates,
    status: capabilities.liveUpdates ? 'Countdown pinned to the status bar' : 'Off, so the countdown is not pinned to the status bar',
    fix: { label: 'Open', page: 'notifications' }
  });
  if (capabilities.xiaomiIsland === 'on' || capabilities.xiaomiIsland === 'off') items.push({
    key: 'island',
    label: 'Super Island',
    ok: capabilities.xiaomiIsland === 'on',
    status: capabilities.xiaomiIsland === 'on' ? 'On' : 'Off. Allow focus notifications in HyperOS',
    fix: { label: 'Open', page: 'notifications' }
  });
  return items;
}

export function NativeAlertChecklist({ capabilities, sound, notify, onChanged }: {
  capabilities: AlertCapabilities | null;
  sound: boolean;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  if (!capabilities) return <p className="alert-checklist-checking" role="status">Checking this phone…</p>;

  async function fix(page: SettingsPage) {
    try {
      // A permission Android has never asked about gets its own prompt; once answered, only
      // Settings can change it.
      if (page === 'notifications' && await notificationPermission(false) === 'default') {
        await notificationPermission(true);
        onChanged();
        return;
      }
      await openNativeSettings(page);
    } catch {
      notify('Could not open Android settings.');
    }
  }

  return (
    <>
      <ul className="alert-checklist">
        {alertChecklist(capabilities, sound).map(item => (
          <li key={item.key} className={item.ok ? 'is-ok' : 'is-off'}>
            {item.ok
              ? <CheckCircle2 size={18} aria-hidden="true" />
              : <AlertTriangle size={18} aria-hidden="true" />}
            <span className="alert-checklist-copy">
              <strong>{item.label}</strong>
              <span>{item.status}</span>
            </span>
            {!item.ok && item.fix && (
              <Button variant="secondary" aria-label={`${item.fix.label}: ${item.label}`} onClick={() => void fix(item.fix!.page)}>
                {item.fix.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {capabilities.serviceError && (
        <CardFeedback title="Workout service" message={capabilities.serviceError} />
      )}
    </>
  );
}
