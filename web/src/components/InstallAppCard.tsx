import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { isStandalone } from '../lib/platform';
import { Button } from './ui/Button';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISSED_KEY = 'workout.install-card-dismissed.v1';

function wasDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

/// In a browser tab, offers to install Workout to the home screen, where it opens full screen and
/// keeps the rest timer and screen wake behaviour of an app. Hidden once installed or dismissed.
export function InstallAppCard() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => {
    if (isStandalone()) return;
    const offer = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!prompt || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* The card simply returns next visit. */ }
  }

  return (
    <section className="panel install-app-card" aria-label="Install Workout">
      <Download size={20} aria-hidden="true" />
      <div>
        <h2>Install Workout</h2>
        <p className="muted">Open it from your home screen, full screen, with the rest timer and screen kept awake like an app.</p>
      </div>
      <div className="install-app-actions">
        <Button variant="tertiary" aria-label="Not now" onClick={dismiss}><X size={18} /></Button>
        <Button variant="primary" onClick={() => void prompt.prompt().then(() => prompt.userChoice).then(() => setPrompt(null)).catch(() => setPrompt(null))}>Install</Button>
      </div>
    </section>
  );
}
