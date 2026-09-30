import { useEffect, useState } from 'react';
import { ArrowRight, Dumbbell } from 'lucide-react';
import { Button } from './ui/Button';
import { centralAuthError } from '../lib/centralAuthError';

export function Auth() {
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const centralError = params.get('central_error');
    if (centralError) setError(centralAuthError(centralError));
  }, []);

  return (
    <div className="auth-screen">
      <div className="panel auth-card">
        <span className="exercise-icon"><Dumbbell size={26} /></span>
        <h1>Welcome</h1>
        <p className="muted">Your training is stored on the server, so it follows you to every device you sign in on.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <Button className="full-width" variant="primary" type="button" onClick={() => { window.location.href = '/api/auth/central/start'; }}>
          Sign in with Fitness Account<ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
