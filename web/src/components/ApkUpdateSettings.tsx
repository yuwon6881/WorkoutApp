import { useEffect, useState } from 'react';
import { checkApkUpdate, lastApkUpdate, openApkRelease, UPDATE_CHECKED } from '../lib/apkUpdates';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';

export function ApkUpdateSettings() {
  const [state, setState] = useState(lastApkUpdate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const changed = () => setState(lastApkUpdate());
    window.addEventListener(UPDATE_CHECKED, changed);
    void checkApkUpdate().then(value => { if (current) setState(value); });
    return () => { current = false; window.removeEventListener(UPDATE_CHECKED, changed); };
  }, []);
  const check = async () => {
    setBusy(true);
    try { setState(await checkApkUpdate(true)); }
    finally { setBusy(false); }
  };
  return <div>
    <p role="status">{state.status === 'available' ? `Android ${state.versionName} is available.`
      : state.status === 'up-to-date' ? 'The installed APK is up to date.'
      : state.status === 'incompatible' ? 'The published package uses a different signing identity and cannot upgrade this installation.'
      : 'Could not check for an APK update. Your app remains available.'}</p>
    <p>Last successful check: {state.lastSuccessfulCheck ? new Date(state.lastSuccessfulCheck).toLocaleString() : 'Not recorded'}</p>
    {error && <CardFeedback title="Release page" message={error}/>}
    <div className="actions">
      <Button variant="secondary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check for updates'}</Button>
      {state.status === 'available' && <Button variant="primary" onClick={() => {
        void openApkRelease().catch(() => setError('The release page could not be opened. Try again.'));
      }}>Open release page</Button>}
    </div>
  </div>;
}
