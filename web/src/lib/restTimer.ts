import { cancelAlarm, primeAlarm, releaseAlarm, scheduleAlarm, soundNow } from './alarm';

/// The rest timer, kept as a deadline rather than a countdown. A phone that sleeps, a tab that
/// is frozen, and a reload all stop JavaScript from counting, but none of them move a clock, so
/// the remaining time is always recomputed from the deadline and is never wrong on return.
///
/// The deadline is the single thing written to the device. Training data is not: it belongs to
/// the account and comes from the server.

const STORAGE_KEY = 'workout.rest';

export type RestState = {
  /// Epoch milliseconds the rest ends, or 0 when no rest is running.
  endsAt: number;
  /// How long this rest was set for, so the display can show progress through it.
  totalSeconds: number;
  /// Set once the end has been announced, so a resume does not announce it twice.
  announced: boolean;
};

type Announcement = 'ended' | 'missed';

const idle: RestState = { endsAt: 0, totalSeconds: 0, announced: true };

export class RestTimer {
  private state: RestState = idle;
  private listeners = new Set<(state: RestState) => void>();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private alerts = true;
  private started = false;

  get current(): RestState { return this.state; }
  get remainingMs(): number { return this.state.endsAt === 0 ? 0 : Math.max(0, this.state.endsAt - Date.now()); }

  /// Picks up a rest that was running before a reload. Nothing sounds on restore: a deadline
  /// that has already passed is reported as missed, not replayed as if it just happened.
  attach(alerts: boolean): () => void {
    this.alerts = alerts;
    if (!this.started) {
      this.started = true;
      this.state = read() ?? idle;
      if (this.state.endsAt > 0 && this.remainingMs === 0) this.state = { ...this.state, announced: true };
    }
    const wake = () => { void this.resumed(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    if (this.remainingMs > 0) this.arm();
    return () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }

  setAlerts(alerts: boolean): void { this.alerts = alerts; }

  subscribe(listener: (state: RestState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /// Starting or extending has to happen inside the tap that caused it: that gesture is the only
  /// moment the browser will let the app open an audio session that can outlive the screen.
  start(seconds: number): void {
    if (seconds <= 0) { this.skip(); return; }
    primeAlarm();
    this.write({ endsAt: Date.now() + seconds * 1000, totalSeconds: seconds, announced: false });
    this.arm();
  }

  extend(seconds: number): void {
    const from = Math.max(Date.now(), this.state.endsAt);
    primeAlarm();
    this.write({ endsAt: from + seconds * 1000, totalSeconds: this.state.totalSeconds + seconds, announced: false });
    this.arm();
  }

  skip(): void {
    this.disarm();
    releaseAlarm();
    this.write(idle);
  }

  /// Everything that can fire the end is set up here, because no single one of them is reliable
  /// on a phone: the tone is queued on the audio clock, the notification on a JavaScript timer,
  /// and the screen is held awake so that in the ordinary case neither is needed.
  private arm(): void {
    this.disarm();
    if (this.remainingMs <= 0) return;
    if (this.alerts) scheduleAlarm(this.state.endsAt);
    this.timeout = setTimeout(() => { void this.announce('ended'); }, this.remainingMs);
    void this.holdScreen();
  }

  private disarm(): void {
    if (this.timeout !== null) { clearTimeout(this.timeout); this.timeout = null; }
    cancelAlarm();
    void this.releaseScreen();
  }

  /// A rest that ends while the user is looking at their phone should not have needed a sound at
  /// all, so the screen is held awake for its duration and released the moment it is over.
  private async holdScreen(): Promise<void> {
    if (this.wakeLock || !('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch { this.wakeLock = null; }
  }

  private async releaseScreen(): Promise<void> {
    const held = this.wakeLock;
    this.wakeLock = null;
    if (held) { try { await held.release(); } catch { /* already gone */ } }
  }

  /// Coming back from a locked screen or a frozen tab. The wake lock is not restored by the
  /// browser, and a deadline may have passed unheard, so both are settled here.
  private async resumed(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    if (this.remainingMs > 0) { await this.holdScreen(); return; }
    if (this.state.endsAt > 0 && !this.state.announced) await this.announce('missed');
  }

  private async announce(kind: Announcement): Promise<void> {
    if (this.state.endsAt === 0 || this.state.announced) return;
    const late = Math.round((Date.now() - this.state.endsAt) / 1000);
    this.write({ ...this.state, announced: true });
    void this.releaseScreen();
    if (!this.alerts) return;
    // The scheduled tone already played for an 'ended'; a missed one never got the chance.
    if (kind === 'missed') soundNow();
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch { /* unsupported */ } }
    await notify(kind === 'missed' && late > 5
      ? { title: 'Rest is over', body: `Your rest finished ${showLate(late)} ago.` }
      : { title: 'Rest is over', body: 'Back to the bar for your next set.' });
  }

  private write(state: RestState): void {
    this.state = state;
    try {
      if (state.endsAt === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* private mode, or storage is full: the timer still runs for this page */ }
    for (const listener of this.listeners) listener(state);
  }
}

function read(): RestState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RestState>;
    if (typeof parsed.endsAt !== 'number' || !Number.isFinite(parsed.endsAt)) return null;
    return { endsAt: parsed.endsAt, totalSeconds: Number(parsed.totalSeconds) || 0, announced: parsed.announced === true };
  } catch { return null; }
}

const showLate = (seconds: number): string =>
  seconds < 60 ? `${seconds} seconds` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/// Android forbids page-constructed notifications, so the service worker raises it where one is
/// running and the page falls back only when it is allowed to.
async function notify(message: { title: string; body: string }): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options: NotificationOptions = {
    body: message.body, icon: '/icon-192.png', badge: '/icon-192.png',
    tag: 'workout-rest', renotify: true, requireInteraction: false
  } as NotificationOptions;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) { await registration.showNotification(message.title, options); return; }
    new Notification(message.title, options);
  } catch { /* the sound and the screen already did their job */ }
}

/// Asking has to come from a tap, and the answer is final: a denial is reported honestly rather
/// than retried on every rest.
export async function requestRestAlerts(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export const restTimer = new RestTimer();
