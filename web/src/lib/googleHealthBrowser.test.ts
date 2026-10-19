import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ active: false, open: vi.fn(), addListener: vi.fn(), connect: vi.fn(), finish: vi.fn() }));
vi.mock('./platform', () => ({ isNative: () => native.active }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: native.open, addListener: native.addListener } }));
vi.mock('./api', () => ({ api: { connectGoogleHealth: native.connect, finishGoogleHealthHandoff: native.finish } }));
import { finishGoogleHealthHandoff, GOOGLE_HEALTH_HANDOFF_EVENT, startGoogleHealthHandoff } from './googleHealthBrowser';

const storage = new Map<string, string>();
const events: Event[] = [];

beforeEach(() => {
  storage.clear();
  events.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }
  });
  vi.stubGlobal('window', { dispatchEvent: (event: Event) => { events.push(event); return true; } });
  native.connect.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=consent-state' });
});

afterEach(async () => {
  native.finish.mockResolvedValue({ status: 'error', code: 'invalid_state' });
  await finishGoogleHealthHandoff();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('Google Health consent handoff', () => {
  it('opens Google consent in a Custom Tab bound to a verifier the app keeps', async () => {
    native.active = true;

    expect(await startGoogleHealthHandoff(true)).toBe(true);

    const [{ syncWorkout, handoffVerifier }] = native.connect.mock.calls[0];
    expect(syncWorkout).toBe(true);
    expect(handoffVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(native.open).toHaveBeenCalledWith({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=consent-state' });
    expect(JSON.parse(storage.get('workout-google-health-handoff')!)).toMatchObject({ state: 'consent-state', verifier: handoffVerifier });
  });

  it('keeps the page-navigation consent outside the Android app', async () => {
    native.active = false;

    expect(await startGoogleHealthHandoff(true)).toBe(false);
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.open).not.toHaveBeenCalled();
  });

  it('finishes with the same state and verifier, then forgets them and reports the result', async () => {
    native.active = true;
    await startGoogleHealthHandoff(false);
    const verifier = native.connect.mock.calls[0][0].handoffVerifier;
    native.finish.mockResolvedValueOnce({ status: 'connected' });

    expect(await finishGoogleHealthHandoff()).toEqual({ status: 'connected' });
    expect(native.finish).toHaveBeenCalledWith({ state: 'consent-state', verifier });
    expect(storage.has('workout-google-health-handoff')).toBe(false);
    expect(events.map(event => [event.type, (event as CustomEvent).detail])).toEqual([[GOOGLE_HEALTH_HANDOFF_EVENT, { status: 'connected' }]]);
    expect(await finishGoogleHealthHandoff()).toEqual({ status: 'none' });
  });

  it('keeps a handoff whose consent is unfinished or whose finish could not reach the server', async () => {
    native.active = true;
    await startGoogleHealthHandoff(true);
    native.finish.mockResolvedValueOnce({ status: 'pending' }).mockRejectedValueOnce(new Error('offline'));

    expect(await finishGoogleHealthHandoff()).toEqual({ status: 'pending' });
    expect(await finishGoogleHealthHandoff()).toEqual({ status: 'pending' });
    expect(storage.has('workout-google-health-handoff')).toBe(true);
    expect(events).toEqual([]);
  });

  it('forgets the handoff when the Custom Tab cannot open', async () => {
    native.active = true;
    native.open.mockRejectedValueOnce(new Error('Unavailable'));

    await expect(startGoogleHealthHandoff(true)).rejects.toThrow('Unavailable');
    expect(storage.has('workout-google-health-handoff')).toBe(false);
    expect(await finishGoogleHealthHandoff()).toEqual({ status: 'none' });
  });
});
