import { useEffect, useState } from 'react';
import { ArrowRight, Dumbbell, LogIn, UserPlus } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';

/// Registration is open only while a slot remains, so the form says which of the two modes
/// is actually available instead of failing after the user has typed everything.
export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.status().then(status => { if (!cancelled) setRegistrationOpen(status.registrationOpen); })
      .catch(() => { if (!cancelled) setRegistrationOpen(null); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'register') await api.register(username, password);
      else await api.login(username, password);
      onSignedIn();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not sign you in. Try again.');
      setBusy(false);
    }
  }

  return <div className="auth-screen">
    <form className="panel auth-card" onSubmit={submit}>
      <span className="exercise-icon"><Dumbbell size={26} /></span>
      <h1>{mode === 'register' ? 'Create your account' : 'Welcome back'}<span className="accent">.</span></h1>
      <p className="muted">Your training is stored on the server, so it follows you to every device you sign in on.</p>
      <label className="field">Username
        <input name="username" autoComplete="username" required minLength={3} maxLength={80} value={username} onChange={e => setUsername(e.target.value)} placeholder="your name" />
      </label>
      <label className="field">Password
        <input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder="at least 12 characters" />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <Button className="full-width" variant="primary" type="submit" disabled={busy}>
        {mode === 'register' ? <UserPlus size={17} /> : <LogIn size={17} />}
        {busy ? 'Signing in…' : mode === 'register' ? 'Create account' : 'Sign in'}
        <ArrowRight size={16} />
      </Button>
      {registrationOpen === false && mode === 'login' && <p className="muted small-copy">Registration is closed: both accounts are taken.</p>}
      {registrationOpen !== false && <Button variant="tertiary" className="full-width" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? 'Create an account instead' : 'I already have an account'}
      </Button>}
    </form>
  </div>;
}
