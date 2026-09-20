import { useEffect, useState } from 'react';
import { Download, LogOut, MonitorSmartphone } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { api } from '../lib/api';
import { requestRestAlerts } from '../lib/restTimer';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { ConnectedApps } from './ConnectedApps';
import { GoogleHealthSettings } from './GoogleHealthSettings';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallEvent | null = null;
// The event is kept so Settings can offer its own Install button, but it is deliberately not
// cancelled: suppressing the browser's own install affordance only logs a console notice and
// takes away the more discoverable path.
window.addEventListener('beforeinstallprompt', e => { installPrompt = e as InstallEvent; window.dispatchEvent(new Event('workout-install-ready')); });

export function SettingsView({ account, preferences, onPreferences, notify, onSignOut }: {
  account: Account; preferences: Preferences; onPreferences: (p: Preferences) => void; notify: (message: string) => void; onSignOut: () => Promise<void>;
}) {
  const [install, setInstall] = useState(installPrompt);
  const [help, setHelp] = useState(false);
  // Said plainly, because the guarantee genuinely differs by state: the screen is held awake
  // during rest, and the sound is queued ahead of time so a locked phone still hears it.
  const alertHint = 'Sounds when your rest ends, with the screen on or locked. If the browser closes the app entirely, you are told what you missed when you come back.';

  useEffect(() => {
    const update = () => setInstall(installPrompt);
    window.addEventListener('workout-install-ready', update);
    return () => window.removeEventListener('workout-install-ready', update);
  }, []);

  useEffect(() => { void api.refreshNutritionContext().catch(() => { /* Nutrition is optional and may be offline. */ }); }, []);

  return <>
    <div className="page-heading"><h1>Settings</h1></div>
    <div className="settings-grid">
      <section className="panel">
        <h2>Training preferences</h2>
        <div className="setting-row"><span><strong>Weight unit</strong></span>
          <Select
            name="weight-unit"
            label="Weight unit"
            value={preferences.unit}
            onChange={val => onPreferences({ ...preferences, unit: val as Preferences['unit'] })}
            options={[
              { value: 'kg', label: 'Kilograms (kg)' },
              { value: 'lb', label: 'Pounds (lb)' }
            ]}
          /></div>
        <div className="setting-row"><span><strong>Rest alerts</strong><small>{alertHint}</small></span>
          <Select
            name="rest-alerts"
            label="Rest alerts"
            value={preferences.restAlerts ? 'on' : 'off'}
            onChange={async val => {
              const wanted = val === 'on';
              if (wanted && (await requestRestAlerts()) === 'denied') notify('Notifications are blocked for this site, so rest alerts will sound but not show a banner.');
              onPreferences({ ...preferences, restAlerts: wanted });
            }}
            options={[
              { value: 'on', label: 'Sound and notification' },
              { value: 'off', label: 'Silent' }
            ]}
          /></div>
        <div className="setting-row"><span><strong>Appearance</strong></span>
          <Select
            name="appearance"
            label="Appearance"
            value={preferences.theme}
            onChange={val => onPreferences({ ...preferences, theme: val as Preferences['theme'] })}
            options={[
              { value: 'dark', label: 'Ayu dark' },
              { value: 'light', label: 'Ayu light' }
            ]}
          /></div>
      </section>

      <section className="panel">
        <div className="section-heading"><h2>Your account</h2></div>
        <div className="setting-row setting-action-row">
          <div className="setting-action-info">
            <strong>{account.displayName}</strong>
            <small>Signed in. Your training is available on every device you sign in on.</small>
          </div>
          <div className="setting-action-controls">
            <Button variant="destructive" onClick={onSignOut}><LogOut size={16} />Sign out</Button>
          </div>
        </div>
      </section>

      <ConnectedApps />
      <GoogleHealthSettings />

      <section className="panel install-card">
        <MonitorSmartphone size={29} className="accent" />
        <h2>Install Workout</h2>
        <p>Add Workout to your home screen. A connection is required while you log because workouts are saved on the server.</p>
        <Button variant="primary" onClick={async () => {
          if (install) { try { await install.prompt(); await install.userChoice; setInstall(null); installPrompt = null; } catch { setHelp(true); } }
          else setHelp(true);
        }}><Download size={17} />Install app</Button>
      </section>
    </div>

    {help && <Modal title="Install Workout" onClose={() => setHelp(false)}>
      <div className="modal-body">
        <h3>iPhone or iPad</h3><p>Open this site in Safari. Tap Share, then Add to Home Screen, and confirm Add.</p>
        <h3>Android</h3><p>Open this site in Chrome. Tap the three-dot menu, then Install app or Add to Home screen.</p>
        <h3>Desktop</h3><p>Use the install icon in Chrome or Edge’s address bar.</p>
      </div>
      <div className="modal-actions"><Button variant="primary" onClick={() => setHelp(false)}>Got it</Button></div>
    </Modal>}
  </>;
}
