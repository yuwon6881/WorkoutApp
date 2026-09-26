import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Watch } from 'lucide-react';
import { api } from '../lib/api';
import type { WatchDevice } from '../types';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import './WatchPairingSettings.css';

export function WatchPairingSettings({ accountId, notify }: { accountId: string; notify: (message: string) => void }) {
  const [devices, setDevices] = useState<WatchDevice[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setDevices(await api.watchDevices());
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load connected watches.');
    }
  }, []);

  useEffect(() => { void reload(); }, [accountId, reload]);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const device = await api.approveWatchPairing(code);
      setCode('');
      await reload();
      notify(`${device.deviceName} is connected to WorkoutApp.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not connect this watch.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: WatchDevice) {
    setBusy(true);
    setError('');
    try {
      await api.revokeWatchDevice(device.id);
      await reload();
      notify(`${device.deviceName} was disconnected.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not disconnect this watch.');
    } finally {
      setBusy(false);
    }
  }

  const codeLength = code.replace(/[^a-z0-9]/gi, '').length;

  return (
    <div className="watch-pairing">
      <form className="watch-pairing-form" onSubmit={event => void approve(event)}>
        <p id="watch-pairing-help" className="watch-pairing-help">
          Enter the 8-character code shown on your watch (expires in 5 min).
        </p>
        <div className="watch-pairing-inputs">
          <Field label="Watch pairing code" name="watch-pairing-code" value={code} maxLength={9} autoComplete="off"
            autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH" aria-describedby="watch-pairing-help"
            onChange={event => setCode(event.target.value.toUpperCase())} />
          <Button type="submit" variant="primary" disabled={busy || codeLength !== 8}>
            {busy ? 'Connecting…' : 'Connect watch'}
          </Button>
        </div>
      </form>
      {error && <p className="error-banner watch-pairing-error" role="alert">{error}</p>}
      {devices.length > 0 && <ul className="watch-device-list" aria-label="Connected Wear OS devices">
        {devices.map(device => (
          <li className="watch-device-row" key={device.id}>
            <span className="watch-device-icon" aria-hidden="true"><Watch size={18} /></span>
            <div>
              <strong>{device.deviceName}</strong>
              <span>Connected · Active</span>
            </div>
            <Button variant="destructive" disabled={busy} onClick={() => void revoke(device)}>Disconnect</Button>
          </li>
        ))}
      </ul>}
      {devices.length === 0 && !error && (
        <p className="watch-device-empty"><Watch size={16} aria-hidden="true" /> No Wear OS watches connected.</p>
      )}
    </div>
  );
}
