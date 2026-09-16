import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';

export function ConnectedApps() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.connectedApps().then(rows => setConnected(rows.some(row => row.peer === 'nutrition' && row.status === 'active')))
      .catch(failure => setError(failure instanceof ApiError ? failure.message : 'Connected app status is unavailable.'));
  }, []);

  function connect() {
    setBusy(true); setError('');
    // The backend performs the authorization-code exchange and stores only the encrypted
    // rotating refresh token. The PWA never receives either token.
    window.location.href = '/api/auth/central/connect';
  }

  async function revoke() {
    setBusy(true); setError('');
    try { await api.revokeApp('nutrition'); setConnected(false); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not revoke Nutrition access.'); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="connected-apps-title">
    <h2 id="connected-apps-title">Connected apps</h2>
    <p>Workout can read Nutrition’s confirmed goal, trend, and bodyweight context. Nutrition never changes workout targets.</p>
    {connected ? <div className="settings-actions"><span className="notice">Nutrition access is granted.</span><Button variant="destructive" disabled={busy} onClick={() => void revoke()}>Revoke access</Button></div>
      : <Button variant="secondary" disabled={busy} onClick={connect}>{busy ? 'Opening account…' : 'Connect Nutrition'}</Button>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
