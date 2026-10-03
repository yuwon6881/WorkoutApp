import {StartupScreen} from './ui/StartupScreen';

export function AuthLoading() {
  return <StartupScreen className="startup-recovery auth-loading">
    <h1 id="startup-heading" aria-busy="true">Opening sign-in…</h1>
  </StartupScreen>;
}
