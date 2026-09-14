import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, KeyRound, LogOut, MonitorSmartphone, Server } from 'lucide-react';
import type { Account, Preferences } from '../types';
import { ApiError, api } from '../lib/api';
import { requestRestAlerts } from '../lib/restTimer';
import { validatePasswordChange, type ValidationErrors } from '../lib/validation';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

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
  const [password, setPassword] = useState(false);
  // Said plainly, because the guarantee genuinely differs by state: the screen is held awake
  // during rest, and the sound is queued ahead of time so a locked phone still hears it.
  const alertHint = 'Sounds when your rest ends, with the screen on or locked. If the browser closes the app entirely, you are told what you missed when you come back.';

  useEffect(() => {
    const update = () => setInstall(installPrompt);
    window.addEventListener('workout-install-ready', update);
    return () => window.removeEventListener('workout-install-ready', update);
  }, []);

  async function exportAccount() {
    try {
      const payload = await api.exportAccount();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `workout-export-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Export downloaded. It is a readable copy, not a restore file.');
    } catch (failure) { notify(failure instanceof ApiError ? failure.message : 'Could not build your export.'); }
  }

  return <>
    <div className="page-heading"><div className="eyebrow">MAKE IT WORK FOR YOU</div><h1>Your preferences<span className="accent">.</span></h1><p>A few simple settings. Your own training space.</p></div>
    <div className="settings-grid">
      <section className="panel">
        <h2>Training preferences</h2>
        <label className="setting-row"><span><strong>Weight unit</strong><small>Loads are stored in kilograms and shown in your unit.</small></span>
          <select name="weight-unit" aria-label="Weight unit" value={preferences.unit} onChange={e => onPreferences({ ...preferences, unit: e.target.value as Preferences['unit'] })}>
            <option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select></label>
        <label className="setting-row"><span><strong>Rest between sets</strong><small>Starts when you complete a set.</small></span>
          <select name="rest-seconds" aria-label="Rest between sets" value={preferences.restSeconds} onChange={e => onPreferences({ ...preferences, restSeconds: Number(e.target.value) })}>
            {[0, 30, 60, 90, 120, 180, 240, 300].map(n => <option key={n} value={n}>{n ? `${n} seconds` : 'Off'}</option>)}</select></label>
        <label className="setting-row"><span><strong>Rest alerts</strong><small>{alertHint}</small></span>
          <select name="rest-alerts" aria-label="Rest alerts" value={preferences.restAlerts ? 'on' : 'off'} onChange={async e => {
            const wanted = e.target.value === 'on';
            // Permission can only be asked for from a real interaction, and a refusal is kept:
            // the sound still works, so the setting stays on and the copy says what is missing.
            if (wanted && (await requestRestAlerts()) === 'denied') notify('Notifications are blocked for this site, so rest alerts will sound but not show a banner.');
            onPreferences({ ...preferences, restAlerts: wanted });
          }}><option value="on">Sound and notification</option><option value="off">Silent</option></select></label>
        <label className="setting-row"><span><strong>Appearance</strong><small>Choose your training environment.</small></span>
          <select name="appearance" aria-label="Appearance" value={preferences.theme} onChange={e => onPreferences({ ...preferences, theme: e.target.value as Preferences['theme'] })}>
            <option value="dark">Ayu dark</option><option value="light">Ayu light</option></select></label>
      </section>

      <section className="panel">
        <div className="section-heading"><h2>Your account</h2><Server size={20} /></div>
        <p>Signed in as <strong>{account.username}</strong>. Your training lives on the server, so it is the same on every device you sign in on.</p>
        <div className="settings-actions">
          <Button onClick={() => setPassword(true)}><KeyRound size={17} />Change password</Button>
          <Button onClick={exportAccount}><Download size={17} />Export a copy</Button>
          <Button variant="destructive" onClick={onSignOut}><LogOut size={17} />Sign out</Button>
        </div>
        <p className="muted small-copy">The export is a readable copy of your account for your own records. There is no restore: it cannot be uploaded back.</p>
      </section>

      <section className="panel install-card">
        <MonitorSmartphone size={29} className="accent" />
        <h2>Your gym companion</h2>
        <p>Install Workout on your home screen and open it like an app. A connection is still required: workouts are saved on the server as you log them, not on the device.</p>
        <Button variant="primary" onClick={async () => {
          if (install) { try { await install.prompt(); await install.userChoice; setInstall(null); installPrompt = null; } catch { setHelp(true); } }
          else setHelp(true);
        }}><Download size={17} />Install app</Button>
      </section>

      <section className="panel about-card">
        <span className="tiny-label accent">WORKOUT · VERSION 2.0</span>
        <h2>Built for the long game.</h2>
        <p>An independent workout tracker. Plan your training, track your effort, and make progress at your pace.</p>
        <p className="muted">Not affiliated with MacroFactor. Progress is based on your logged sets; no proprietary coaching algorithm is used.</p>
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

    {password && <PasswordDialog onClose={() => setPassword(false)} onChanged={async () => { setPassword(false); notify('Password changed. Sign in again with your new password.'); await onSignOut(); }} />}
  </>;
}

function PasswordDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const currentInput = useRef<HTMLInputElement>(null);
  const nextInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validatePasswordChange(current, next);
    setFieldErrors(nextErrors);
    setError('');
    const firstInvalid = nextErrors.current ? currentInput : nextErrors.next ? nextInput : null;
    if (firstInvalid) { firstInvalid.current?.focus(); return; }
    setBusy(true);
    try { await api.changePassword(current, next); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not change your password.'); setBusy(false); }
  }

  return <Modal title="Change your password" onClose={onClose}>
    <form className="modal-form" noValidate onSubmit={submit}>
      <div className="modal-body">
      <label className={`field ${fieldErrors.current ? 'has-error' : ''}`} htmlFor="current-password">Current password<input id="current-password" name="current-password" ref={currentInput} type="password" autoComplete="current-password" aria-invalid={fieldErrors.current ? 'true' : 'false'} aria-describedby={fieldErrors.current ? 'current-password-error' : undefined} value={current} onChange={e => { setCurrent(e.target.value); if (fieldErrors.current) setFieldErrors(errors => ({ ...errors, current: validatePasswordChange(e.target.value, next).current ?? '' })); }} onBlur={() => setFieldErrors(errors => ({ ...errors, current: validatePasswordChange(current, next).current ?? '' }))} /></label>
      {fieldErrors.current && <span id="current-password-error" className="field-error" role="alert">{fieldErrors.current}</span>}
      <label className={`field ${fieldErrors.next ? 'has-error' : ''}`} htmlFor="new-password">New password<input id="new-password" name="new-password" ref={nextInput} type="password" autoComplete="new-password" aria-invalid={fieldErrors.next ? 'true' : 'false'} aria-describedby={fieldErrors.next ? 'new-password-error' : undefined} value={next} onChange={e => { setNext(e.target.value); if (fieldErrors.next) setFieldErrors(errors => ({ ...errors, next: validatePasswordChange(current, e.target.value).next ?? '' })); }} onBlur={() => setFieldErrors(errors => ({ ...errors, next: validatePasswordChange(current, next).next ?? '' }))} placeholder="at least 12 characters" /></label>
      {fieldErrors.next && <span id="new-password-error" className="field-error" role="alert">{fieldErrors.next}</span>}
      <p className="muted small-copy">Changing your password signs out every device, including this one.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
      <Button onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Changing password…' : 'Change password'}</Button>
      </div>
    </form>
  </Modal>;
}
