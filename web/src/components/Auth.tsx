import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Dumbbell, ListChecks, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { StartupScreen } from './ui/StartupScreen';
import { centralAuthError } from '../lib/centralAuthError';

export function Auth() {
  const [errorCode] = useState(() => new URLSearchParams(window.location.search).get('central_error'));
  const [starting, setStarting] = useState(false);
  const navigationStarted = useRef(false);

  useEffect(() => {
    const restore = () => { navigationStarted.current = false; setStarting(false); };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  return (
    <StartupScreen className="startup-login">
      <p className="eyebrow">YOUR TRAINING SPACE</p>
      <h1 id="startup-heading">Sign in to Workout</h1>
      <p className="startup-description">Use your Fitness Account to access your programs, record your workouts, and follow your progress across devices.</p>
      <ul className="startup-features" aria-label="Workout features">
        <li><Dumbbell size={22} aria-hidden="true" /><div><strong>Programs</strong><span>Plan your training</span></div></li>
        <li><ListChecks size={22} aria-hidden="true" /><div><strong>Training log</strong><span>Record every set</span></div></li>
        <li><ChartNoAxesCombined size={22} aria-hidden="true" /><div><strong>Progress</strong><span>Review your history</span></div></li>
      </ul>
      {errorCode && <CardFeedback
        tone={errorCode === 'access_denied' ? 'info' : 'error'}
        title={errorCode === 'access_denied' ? 'Sign-in cancelled' : 'Sign-in could not be completed'}
        message={errorCode === 'access_denied' ? 'You’re still signed out. Sign in again when you’re ready to allow access to Workout.' : centralAuthError(errorCode)}
      />}
      <Button className="startup-submit" variant="primary" type="button" disabled={starting} aria-busy={starting} onClick={() => {
        if (navigationStarted.current) return;
        navigationStarted.current = true;
        setStarting(true);
        window.location.assign('/api/auth/central/start');
      }}>
        <span>{starting ? 'Opening Fitness Account…' : 'Sign in with Fitness Account'}</span>
        {starting ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
      </Button>
      <p className="startup-registration">New to Workout? You can create an account on the next screen.</p>
    </StartupScreen>
  );
}
