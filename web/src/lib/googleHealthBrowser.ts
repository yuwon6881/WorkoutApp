import { api } from './api';
import { isNative } from './platform';

/// Google refuses its consent screen inside an embedded WebView, so the Android app shows it in a
/// Custom Tab instead. That tab has no Workout session, so the server only parks Google's answer;
/// this app, which alone holds the verifier, finishes the connection under its own session once the
/// tab hands back (by the /open/settings App Link, or by the person closing it).

export type GoogleHealthHandoffOutcome =
  | { status: 'none' | 'pending' | 'connected' }
  | { status: 'error'; code: string };

export const GOOGLE_HEALTH_HANDOFF_EVENT = 'workout:google-health-handoff';

type PendingHandoff = { state: string; verifier: string; expiresAt: number };

const storageKey = 'workout-google-health-handoff';
// The server keeps a consent state for ten minutes; a little less here avoids a certain refusal.
const handoffLifetimeMs = 9 * 60 * 1000;

let pending: PendingHandoff | null = null;
let finishing: Promise<GoogleHealthHandoffOutcome> | null = null;
let listening = false;

function newVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Android may reclaim the WebView while the tab is in front, so the handoff survives a reload.
// Storage is best-effort: without it the in-memory copy still covers the ordinary return.
function remember(handoff: PendingHandoff | null) {
  pending = handoff;
  try {
    if (handoff) localStorage.setItem(storageKey, JSON.stringify(handoff));
    else localStorage.removeItem(storageKey);
  } catch { /* the in-memory copy remains */ }
}

function recall(): PendingHandoff | null {
  if (!pending) {
    try {
      const stored = localStorage.getItem(storageKey);
      pending = stored ? JSON.parse(stored) as PendingHandoff : null;
    } catch { pending = null; }
  }
  if (pending && pending.expiresAt < Date.now()) remember(null);
  return pending;
}

/// Opens Google's consent in a Custom Tab. False outside the Android app, where the page itself
/// navigates to Google and the session-bound callback finishes the connection.
export async function startGoogleHealthHandoff(syncWorkout: boolean): Promise<boolean> {
  if (!isNative()) return false;
  const verifier = newVerifier();
  const { authUrl } = await api.connectGoogleHealth({ syncWorkout, handoffVerifier: verifier });
  const state = new URL(authUrl).searchParams.get('state');
  if (!state) throw new Error('Google Health did not return a connection link. Try again.');
  remember({ state, verifier, expiresAt: Date.now() + handoffLifetimeMs });

  const { Browser } = await import('@capacitor/browser');
  try {
    if (!listening) {
      await Browser.addListener('browserFinished', () => { void finishGoogleHealthHandoff(); });
      listening = true;
    }
    await Browser.open({ url: authUrl });
  } catch (failure) {
    remember(null);
    throw failure;
  }
  return true;
}

/// Finishes a handoff the app started, if any; safe to call on every return to the app.
export function finishGoogleHealthHandoff(): Promise<GoogleHealthHandoffOutcome> {
  finishing ??= finish().finally(() => { finishing = null; });
  return finishing;
}

async function finish(): Promise<GoogleHealthHandoffOutcome> {
  const handoff = recall();
  if (!handoff) return { status: 'none' };
  let outcome: GoogleHealthHandoffOutcome;
  try {
    const result = await api.finishGoogleHealthHandoff({ state: handoff.state, verifier: handoff.verifier });
    outcome = result.status === 'error' ? { status: 'error', code: result.code ?? 'provider_error' } : { status: result.status };
  } catch {
    // Offline or a server hiccup: keep the handoff so the next return can still finish it.
    return { status: 'pending' };
  }
  if (outcome.status !== 'pending') {
    remember(null);
    window.dispatchEvent(new CustomEvent(GOOGLE_HEALTH_HANDOFF_EVENT, { detail: outcome }));
  }
  return outcome;
}
