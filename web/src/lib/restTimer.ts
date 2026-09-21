import { cancelAlarm, primeAlarm, releaseAlarm, scheduleAlarm, soundNow, testAlarmSound } from './alarm';

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

  get current(): RestState { return this.state; }
  get remainingMs(): number {
    return this.state.endsAt === 0 ? Math.max(0, this.state.pausedRemainingMs) : Math.max(0, this.state.endsAt - Date.now());
  }

  setScope(accountId: string | null, sessionId: string | null, options: RestTimerOptions = defaults): void {
    const changed = accountId !== this.accountId || sessionId !== this.sessionId;
    this.options = options;
    if (!changed) { this.syncAlarm(); return; }
    this.disarm();
    void this.releaseScreen();
    releaseAlarm();
    this.accountId = accountId;
    this.sessionId = sessionId;
    this.storageKey = accountId && sessionId ? `${STORAGE_PREFIX}:${accountId}:${sessionId}` : null;
    this.state = this.storageKey ? read(this.storageKey) ?? idle() : idle();
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* the old record is ignored */ }
    if (this.state.endsAt > 0 && this.remainingMs === 0) this.state = { ...this.state, announced: true };
    this.emit();
    this.syncAlarm();
  }

  setOptions(options: RestTimerOptions): void { this.options = options; this.syncAlarm(); }

  primeSound(): boolean { return this.options.sound && primeAlarm(); }

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

  start(seconds: number): void {
    if (seconds <= 0) { this.skip(); return; }
    if (this.options.sound) primeAlarm();
    this.write({ endsAt: Date.now() + seconds * 1000, totalSeconds: seconds, announced: false, generation: newGeneration(), pausedRemainingMs: 0 });
    this.arm();
  }

  extend(seconds: number): void {
    if (seconds <= 0) return;
    if (this.options.sound) primeAlarm();
    if (this.state.endsAt === 0 && this.state.pausedRemainingMs > 0) {
      this.write({ ...this.state, totalSeconds: this.state.totalSeconds + seconds, pausedRemainingMs: this.state.pausedRemainingMs + seconds * 1000, generation: newGeneration(), announced: false });
      return;
    }
    const from = Math.max(Date.now(), this.state.endsAt);
    const totalSeconds = this.state.totalSeconds + seconds;
    this.write({ endsAt: from + seconds * 1000, totalSeconds, announced: false, generation: newGeneration(), pausedRemainingMs: 0 });
    this.arm();
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
    if (this.options.sound) scheduleAlarm(this.state.endsAt);
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
    if (this.options.sound && kind === 'missed') soundNow();
    if (this.options.vibration && navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch { /* unsupported */ } }
    if (this.options.notifications) await notify({ lateSeconds: late, sessionId: this.sessionId });
  }

  private write(state: RestState): void {
    this.state = state;
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

export function isRestAlertOwner(
  owner: { accountId: string | null; sessionId: string | null; generation: string; endsAt: number; visible: boolean },
  alert: { sessionId: string; generation: string },
  now = Date.now()
): boolean {
  return owner.visible && Boolean(owner.accountId) && owner.sessionId === alert.sessionId &&
    owner.generation === alert.generation && owner.endsAt > 0 && owner.endsAt <= now;
}

export async function requestRestAlerts(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export { testAlarmSound };
export const restTimer = new RestTimer();
