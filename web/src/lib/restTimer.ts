import { cancelAlarm, primeAlarm, releaseAlarm, scheduleAlarm, soundNow, testAlarmSound } from './alarm';
import type { SessionRest } from '../types';
import { claimNativeRestAlert, hasNativeWorkoutStore, isNative, nativeKeepAwake, notificationPermission, syncNativeWorkout } from './platform';

/// Rest uses a deadline so its display stays accurate when the browser suspends the page. The
/// local record is scoped to the signed-in account and active workout; it is never an authority
/// for training data or a promise that an alarm can run after the browser kills the PWA.
const LEGACY_STORAGE_KEY = 'workout.rest';
const STORAGE_PREFIX = 'workout.rest.v2';

export type RestState = {
  endsAt: number;
  totalSeconds: number;
  announced: boolean;
  generation: string;
  pausedRemainingMs: number;
};

export type RestTimerOptions = { notifications: boolean; sound: boolean; vibration: boolean; keepAwake: boolean };
/// When the workout started and how long it has been paused, for the Android workout notification.
export type WorkoutClock = { startedAtMs: number; pausedAtMs: number | null; pausedSeconds: number };
type Announcement = 'ended' | 'missed';

const idle = (): RestState => ({ endsAt: 0, totalSeconds: 0, announced: true, generation: '', pausedRemainingMs: 0 });
const defaults: RestTimerOptions = { notifications: false, sound: true, vibration: false, keepAwake: false };

export class RestTimer {
  private state: RestState = idle();
  private listeners = new Set<(state: RestState) => void>();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private options: RestTimerOptions = defaults;
  private accountId: string | null = null;
  private sessionId: string | null = null;
  private storageKey: string | null = null;
  private workoutVisible = false;
  private nativeAwake = false;
  private clock: WorkoutClock | null = null;
  // The last rest the server confirmed, so a skip made on another device can end the same rest here.
  private serverGeneration: string | null = null;

  get current(): RestState { return this.state; }
  get remainingMs(): number {
    return this.state.endsAt === 0 ? Math.max(0, this.state.pausedRemainingMs) : Math.max(0, this.state.endsAt - Date.now());
  }

  setScope(accountId: string | null, sessionId: string | null, options: RestTimerOptions = defaults): void {
    const changed = accountId !== this.accountId || sessionId !== this.sessionId;
    this.options = options;
    if (!changed) { this.syncAlarm(); this.syncNative(); return; }
    this.disarm();
    void this.releaseScreen();
    releaseAlarm();
    this.accountId = accountId;
    this.sessionId = sessionId;
    this.serverGeneration = null;
    this.storageKey = accountId && sessionId ? `${STORAGE_PREFIX}:${accountId}:${sessionId}` : null;
    this.state = this.storageKey ? read(this.storageKey) ?? idle() : idle();
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* the old record is ignored */ }
    if (this.state.endsAt > 0 && this.remainingMs === 0) this.state = { ...this.state, announced: true };
    this.emit();
    this.syncAlarm();
    this.syncNative();
  }

  setOptions(options: RestTimerOptions): void { this.options = options; this.syncAlarm(); this.syncNative(); }

  /// Takes over the rest the server holds when it is newer than this device's: a rest started or
  /// changed on the watch counts down and alerts here too. The caller skips this while this
  /// device still has its own rest change waiting to sync, so an unsent change is never replaced.
  adoptServerRest(rest: SessionRest | null | undefined): void {
    if (!rest || !this.sessionId) return;
    const previous = this.serverGeneration;
    this.serverGeneration = rest.generation;
    if (rest.generation && rest.generation === this.state.generation) return;
    if (rest.status === 'running' && rest.generation && rest.deadlineUtc) {
      const endsAt = Date.parse(rest.deadlineUtc);
      if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return;
      this.write({ endsAt, totalSeconds: Math.round((rest.durationMs ?? endsAt - Date.now()) / 1000), announced: false, generation: rest.generation, pausedRemainingMs: 0 });
      this.arm();
    } else if (rest.status === 'paused' && rest.generation && (rest.pausedRemainingMs ?? 0) > 0) {
      this.disarm();
      this.write({ endsAt: 0, totalSeconds: Math.round((rest.durationMs ?? 0) / 1000), announced: false, generation: rest.generation, pausedRemainingMs: rest.pausedRemainingMs! });
    } else if (!rest.generation && previous && previous === this.state.generation) {
      // The rest this device took from the server was skipped elsewhere.
      this.skip();
    }
  }

  setWorkoutClock(clock: WorkoutClock | null): void {
    const same = clock?.startedAtMs === this.clock?.startedAtMs && clock?.pausedAtMs === this.clock?.pausedAtMs &&
      clock?.pausedSeconds === this.clock?.pausedSeconds;
    this.clock = clock;
    if (!same) this.syncNative();
  }

  primeSound(): boolean { return this.options.sound && primeAlarm(); }

  /** A timed set reached its target: the same chime and vibration as a rest, under the same preferences. */
  announceSetTimer(): void {
    if (this.options.sound) soundNow();
    if (this.options.vibration && navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch { /* unsupported */ } }
  }

  setWorkoutVisible(visible: boolean): void {
    this.workoutVisible = visible;
    this.syncAlarm();
  }

  attach(): () => void {
    const wake = () => { void this.resumed(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    if (this.remainingMs > 0) this.arm();
    return () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }

  subscribe(listener: (state: RestState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async claimBackgroundAlert(accountId: string, sessionId: string, generation: string): Promise<boolean> {
    if (this.accountId !== accountId || this.sessionId !== sessionId || !isRestAlertOwner({
      accountId: this.accountId,
      sessionId: this.sessionId,
      generation: this.state.generation,
      endsAt: this.state.endsAt,
      visible: document.visibilityState === 'visible'
    }, { sessionId, generation })) return false;
    if (!this.state.announced) await this.announce('ended');
    return true;
  }

  start(seconds: number, customGeneration?: string): void {
    if (seconds <= 0) { this.skip(); return; }
    if (this.options.sound) primeAlarm();
    this.write({ endsAt: Date.now() + seconds * 1000, totalSeconds: seconds, announced: false, generation: customGeneration || newGeneration(), pausedRemainingMs: 0 });
    this.arm();
  }

  extend(seconds: number, generation = newGeneration()): void {
    if (seconds <= 0) return;
    if (this.options.sound) primeAlarm();
    if (this.state.endsAt === 0 && this.state.pausedRemainingMs > 0) {
      this.write({ ...this.state, totalSeconds: this.state.totalSeconds + seconds, pausedRemainingMs: this.state.pausedRemainingMs + seconds * 1000, generation, announced: false });
      return;
    }
    const from = Math.max(Date.now(), this.state.endsAt);
    const totalSeconds = this.state.totalSeconds + seconds;
    this.write({ endsAt: from + seconds * 1000, totalSeconds, announced: false, generation, pausedRemainingMs: 0 });
    this.arm();
  }

  /// Takes time off a running or paused rest. Cutting past the end finishes the rest quietly
  /// rather than announcing it, because the lifter chose to go early.
  shorten(seconds: number, generation = newGeneration()): void {
    if (seconds <= 0) return;
    const next = shortenedRest(this.state, seconds, Date.now());
    if (!next) { this.skip(); return; }
    this.write({ ...next, generation });
    if (next.endsAt > 0) this.arm();
  }

  pause(): void {
    if (this.state.endsAt <= 0) return;
    const remaining = this.remainingMs;
    this.disarm();
    this.write({ ...this.state, endsAt: 0, pausedRemainingMs: remaining, announced: false, generation: newGeneration() });
  }

  resume(): void {
    if (this.state.pausedRemainingMs <= 0) return;
    const remaining = this.state.pausedRemainingMs;
    this.write({ ...this.state, endsAt: Date.now() + remaining, pausedRemainingMs: 0, announced: false, generation: newGeneration() });
    this.arm();
  }

  skip(): void {
    this.disarm();
    releaseAlarm();
    this.write(idle());
  }

  private syncAlarm(): void {
    if (this.remainingMs > 0 && this.state.endsAt > 0) this.arm();
    else {
      this.disarm();
      if (this.shouldHoldScreen()) void this.holdScreen();
    }
  }

  private arm(): void {
    this.disarm();
    if (this.remainingMs <= 0 || this.state.endsAt === 0) return;
    // The Android service owns the timed chime; a pre-scheduled page chime would be a second one.
    if (this.options.sound && !hasNativeWorkoutStore()) scheduleAlarm(this.state.endsAt);
    this.timeout = setTimeout(() => { void this.announce('ended'); }, this.remainingMs);
    if (this.shouldHoldScreen()) void this.holdScreen();
  }

  private disarm(): void {
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
    cancelAlarm();
    if (!this.shouldHoldScreen()) void this.releaseScreen();
  }

  private shouldHoldScreen(): boolean {
    return this.options.keepAwake && this.workoutVisible && document.visibilityState === 'visible';
  }

  private async holdScreen(): Promise<void> {
    if (isNative()) {
      if (!this.shouldHoldScreen() || this.nativeAwake) return;
      this.nativeAwake = true;
      await nativeKeepAwake(true);
      return;
    }
    if (!this.shouldHoldScreen() || this.wakeLock || !('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        if (this.shouldHoldScreen()) void this.holdScreen();
      }, { once: true });
    } catch { this.wakeLock = null; }
  }

  private async releaseScreen(): Promise<void> {
    if (this.nativeAwake) { this.nativeAwake = false; await nativeKeepAwake(false); }
    const held = this.wakeLock;
    this.wakeLock = null;
    if (held) { try { await held.release(); } catch { /* already released by the browser */ } }
  }

  private async resumed(): Promise<void> {
    if (document.visibilityState !== 'visible') { if (this.wakeLock) await this.releaseScreen(); return; }
    if (this.shouldHoldScreen()) await this.holdScreen();
    if (this.remainingMs > 0 && this.state.endsAt > 0) { this.arm(); return; }
    if (this.state.endsAt > 0 && !this.state.announced) await this.announce('missed');
  }

  private async announce(kind: Announcement): Promise<void> {
    if (this.state.endsAt === 0 || this.state.announced) return;
    const late = Math.round((Date.now() - this.state.endsAt) / 1000);
    const state = this.state;
    this.write({ ...state, announced: true });
    if (this.shouldHoldScreen()) void this.holdScreen();
    else void this.releaseScreen();
    if (hasNativeWorkoutStore()) {
      // In the Android app the service alerts while the page is hidden; in view, whichever of the
      // two claims this rest first is the only one that sounds.
      if (document.visibilityState !== 'visible' || !this.sessionId ||
        !await claimNativeRestAlert(this.sessionId, state.generation)) return;
      if (this.options.sound) soundNow();
    } else if (this.options.sound && kind === 'missed') soundNow();
    if (this.options.vibration && navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch { /* unsupported */ } }
    if (this.options.notifications) await notify({ lateSeconds: late, sessionId: this.sessionId });
  }

  /// The Android service shows the same rest from one snapshot. A rest stays "running" after its
  /// deadline until it is skipped or replaced, so the service can still alert for it while the
  /// page is hidden; the service itself treats a long-past deadline as already finished.
  private syncNative(): void {
    if (!this.sessionId) { syncNativeWorkout(null); return; }
    const running = this.state.endsAt > 0;
    const paused = !running && this.state.pausedRemainingMs > 0;
    syncNativeWorkout({
      sessionId: this.sessionId,
      generation: this.state.generation,
      status: running ? 'running' : paused ? 'paused' : 'idle',
      deadlineMs: running ? this.state.endsAt : 0,
      pausedRemainingMs: paused ? this.state.pausedRemainingMs : 0,
      startedAtMs: this.clock?.startedAtMs ?? null,
      pausedAtMs: this.clock?.pausedAtMs ?? null,
      pausedSeconds: this.clock?.pausedSeconds ?? 0,
      alert: this.options.notifications,
      sound: this.options.sound,
      vibrate: this.options.vibration
    });
  }

  private write(state: RestState): void {
    const native = state.endsAt !== this.state.endsAt || state.generation !== this.state.generation ||
      state.pausedRemainingMs !== this.state.pausedRemainingMs;
    this.state = state;
    if (native) this.syncNative();
    try {
      if (!this.storageKey || state.endsAt === 0 && state.pausedRemainingMs === 0) {
        if (this.storageKey) localStorage.removeItem(this.storageKey);
      } else localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch { /* local timer continues in this page; next launch may not recover it */ }
    this.emit();
  }

  private emit(): void { for (const listener of this.listeners) listener(this.state); }
}

function read(key: string): RestState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RestState>;
    if (typeof parsed.endsAt !== 'number' || !Number.isFinite(parsed.endsAt)) return null;
    return {
      endsAt: parsed.endsAt,
      totalSeconds: Number(parsed.totalSeconds) || 0,
      announced: parsed.announced === true,
      generation: typeof parsed.generation === 'string' ? parsed.generation : newGeneration(),
      pausedRemainingMs: Number(parsed.pausedRemainingMs) || 0
    };
  } catch { return null; }
}

function newGeneration(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

async function notify(message: { lateSeconds: number; sessionId: string | null }): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const data = message.sessionId ? { sessionId: message.sessionId, url: `/?workout=${encodeURIComponent(message.sessionId)}` } : undefined;
  const body = message.lateSeconds > 5 ? `Your rest ended ${showLate(message.lateSeconds)} ago.` : 'Your rest is over.';
  const options: NotificationOptions = {
    body, icon: '/icon-192.png', badge: '/icon-192.png', tag: `workout-rest-${message.sessionId ?? 'active'}`,
    renotify: true, requireInteraction: false, data
  } as NotificationOptions;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) { await registration.showNotification('Rest timer', options); return; }
    new Notification('Rest timer', options);
  } catch { /* visible timer and sound remain available */ }
}

function showLate(seconds: number): string {
  return seconds < 60 ? `${seconds} seconds` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function shortenedRest(state: RestState, seconds: number, now: number): RestState | null {
  if (state.endsAt === 0) {
    if (state.pausedRemainingMs <= 0) return null;
    const pausedRemainingMs = state.pausedRemainingMs - seconds * 1000;
    return pausedRemainingMs > 0 ? { ...state, pausedRemainingMs, announced: false } : null;
  }
  const endsAt = state.endsAt - seconds * 1000;
  return endsAt > now ? { ...state, endsAt, announced: false } : null;
}

export function remainingRestSeconds(state: Pick<RestState, 'endsAt' | 'pausedRemainingMs' | 'totalSeconds'>, now: number): number {
  const milliseconds = state.endsAt === 0 ? state.pausedRemainingMs : state.endsAt - now;
  const remaining = Math.max(0, Math.ceil(milliseconds / 1000));
  // A newly started timer can render before the screen's next one-second tick.
  // That older tick must not add a second to the configured rest duration.
  return state.totalSeconds > 0 ? Math.min(state.totalSeconds, remaining) : remaining;
}

export function isRestAlertOwner(
  owner: { accountId: string | null; sessionId: string | null; generation: string; endsAt: number; visible: boolean },
  alert: { sessionId: string; generation: string },
  now = Date.now()
): boolean {
  return owner.visible && Boolean(owner.accountId) && owner.sessionId === alert.sessionId &&
    owner.generation === alert.generation && owner.endsAt > 0 && owner.endsAt <= now;
}

export async function requestRestAlerts(): Promise<NotificationPermission> {
  if (isNative()) return notificationPermission(true);
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export { testAlarmSound };
export const restTimer = new RestTimer();
