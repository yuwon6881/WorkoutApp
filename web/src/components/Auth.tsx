import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Dumbbell, LogIn, UserPlus } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { validateAuth, validatePassword, validateUsername, type ValidationErrors } from '../lib/validation';
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
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.status().then(status => { if (!cancelled) setRegistrationOpen(status.registrationOpen); })
      .catch(() => { if (!cancelled) setRegistrationOpen(null); });
    return () => { cancelled = true; };
  }, []);

  function validateField(field: 'username' | 'password', value: string) {
    const message = field === 'username' ? validateUsername(value, mode === 'register') : validatePassword(value, mode === 'register');
    setFieldErrors(current => ({ ...current, [field]: message ?? '' }));
  }

  function updateUsername(value: string) {
    setUsername(value);
    if (fieldErrors.username) validateField('username', value);
  }

  function updatePassword(value: string) {
    setPassword(value);
    if (fieldErrors.password) validateField('password', value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateAuth(mode, username, password);
    setFieldErrors(nextErrors);
    setError('');
    const firstInvalid = nextErrors.username ? usernameInput : nextErrors.password ? passwordInput : null;
    if (firstInvalid) { firstInvalid.current?.focus(); return; }
    setBusy(true);
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
    <form className="panel auth-card" noValidate onSubmit={submit}>
      <span className="exercise-icon"><Dumbbell size={26} /></span>
      <h1>{mode === 'register' ? 'Create your account' : 'Welcome back'}<span className="accent">.</span></h1>
      <p className="muted">Your training is stored on the server, so it follows you to every device you sign in on.</p>
      <label className={`field ${fieldErrors.username ? 'has-error' : ''}`} htmlFor="auth-username">Username
        <input id="auth-username" name="username" ref={usernameInput} autoComplete="username" aria-invalid={fieldErrors.username ? 'true' : 'false'} aria-describedby={fieldErrors.username ? 'auth-username-error' : undefined} value={username} onChange={e => updateUsername(e.target.value)} onBlur={() => validateField('username', username)} placeholder="your name" />
        {fieldErrors.username && <span id="auth-username-error" className="field-error" role="alert">{fieldErrors.username}</span>}
      </label>
      <label className={`field ${fieldErrors.password ? 'has-error' : ''}`} htmlFor="auth-password">Password
        <input id="auth-password" name="password" ref={passwordInput} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} aria-invalid={fieldErrors.password ? 'true' : 'false'} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} value={password} onChange={e => updatePassword(e.target.value)} onBlur={() => validateField('password', password)} placeholder="at least 12 characters" />
        {fieldErrors.password && <span id="auth-password-error" className="field-error" role="alert">{fieldErrors.password}</span>}
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <Button className="full-width" variant="primary" type="submit" disabled={busy}>
        {mode === 'register' ? <UserPlus size={17} /> : <LogIn size={17} />}
        {busy ? 'Signing in…' : mode === 'register' ? 'Create account' : 'Sign in'}
        <ArrowRight size={16} />
      </Button>
      <Button className="full-width" variant="secondary" type="button" onClick={() => { window.location.href = '/api/auth/central/start'; }}>Sign in with Fitness Account<ArrowRight size={16} /></Button>
      {registrationOpen === false && mode === 'login' && <p className="muted small-copy">Registration is closed: both accounts are taken.</p>}
      {registrationOpen !== false && <Button variant="tertiary" className="full-width" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setFieldErrors({}); }}>
        {mode === 'login' ? 'Create an account instead' : 'I already have an account'}
      </Button>}
    </form>
  </div>;
}
