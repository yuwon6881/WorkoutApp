import { describe, expect, it } from 'vitest';
import { RestTimer, isRestAlertOwner, remainingRestSeconds, shortenedRest } from './restTimer';

const alert = { sessionId: 'session-a', generation: 'generation-a' };
const owner = {
  accountId: 'account-a', sessionId: 'session-a', generation: 'generation-a',
  endsAt: 100, visible: true
};

describe('remaining rest duration', () => {
  it('never displays more than the prescribed duration when the screen tick predates a new deadline', () => {
    expect(remainingRestSeconds({ endsAt: 220_000, totalSeconds: 120, pausedRemainingMs: 0 }, 99_500)).toBe(120);
  });

  it('counts down from the deadline and preserves paused and extended durations', () => {
    expect(remainingRestSeconds({ endsAt: 220_000, totalSeconds: 120, pausedRemainingMs: 0 }, 115_100)).toBe(105);
    expect(remainingRestSeconds({ endsAt: 0, totalSeconds: 120, pausedRemainingMs: 30_100 }, 300_000)).toBe(31);
    expect(remainingRestSeconds({ endsAt: 250_000, totalSeconds: 150, pausedRemainingMs: 0 }, 100_000)).toBe(150);
    expect(remainingRestSeconds({ endsAt: 220_000, totalSeconds: 120, pausedRemainingMs: 0 }, 221_000)).toBe(0);
  });
});

describe('rest alert ownership', () => {
  it('matches only a visible, authenticated account timer for the same expired session and generation', () => {
    expect(isRestAlertOwner(owner, alert, 100)).toBe(true);
    expect(isRestAlertOwner({ ...owner, visible: false }, alert, 100)).toBe(false);
    expect(isRestAlertOwner({ ...owner, accountId: null }, alert, 100)).toBe(false);
    expect(isRestAlertOwner({ ...owner, sessionId: 'session-b' }, alert, 100)).toBe(false);
    expect(isRestAlertOwner({ ...owner, generation: 'generation-b' }, alert, 100)).toBe(false);
    expect(isRestAlertOwner({ ...owner, endsAt: 101 }, alert, 100)).toBe(false);
    expect(isRestAlertOwner({ ...owner, endsAt: 0 }, alert, 100)).toBe(false);
  });
});

describe('shortening a rest', () => {
  const running = { endsAt: 100_000, totalSeconds: 90, announced: false, generation: 'g', pausedRemainingMs: 0 };

  it('moves a running deadline earlier and keeps the total for the progress bar', () => {
    expect(shortenedRest(running, 15, 50_000)).toEqual({ ...running, endsAt: 85_000 });
  });

  it('ends the rest when the cut reaches the deadline', () => {
    expect(shortenedRest(running, 15, 90_000)).toBeNull();
  });

  it('shortens a paused rest by its remaining time', () => {
    const paused = { ...running, endsAt: 0, pausedRemainingMs: 40_000 };
    expect(shortenedRest(paused, 15, 0)).toEqual({ ...paused, pausedRemainingMs: 25_000 });
    expect(shortenedRest({ ...paused, pausedRemainingMs: 10_000 }, 15, 0)).toBeNull();
  });
});

describe('taking over a rest from another device', () => {
  const quiet = { notifications: false, sound: false, vibration: false, keepAwake: false };
  const timer = () => {
    const created = new RestTimer();
    created.setScope('account-a', 'session-a', quiet);
    return created;
  };
  const inTwoMinutes = () => new Date(Date.now() + 120_000).toISOString();

  it('counts down a newer rest started on the watch', () => {
    const rest = timer();
    const deadline = inTwoMinutes();
    rest.adoptServerRest({ generation: 'watch-1', status: 'running', deadlineUtc: deadline, pausedRemainingMs: null, durationMs: 120_000, originDeviceId: 'watch' });
    expect(rest.current.generation).toBe('watch-1');
    expect(rest.current.endsAt).toBe(Date.parse(deadline));
    expect(rest.current.totalSeconds).toBe(120);
    rest.skip();
  });

  it('leaves its own rest and an already ended one alone', () => {
    const rest = timer();
    rest.start(90, 'phone-1');
    const endsAt = rest.current.endsAt;
    rest.adoptServerRest({ generation: 'phone-1', status: 'running', deadlineUtc: inTwoMinutes(), pausedRemainingMs: null, durationMs: 120_000, originDeviceId: null });
    expect(rest.current.endsAt).toBe(endsAt);
    rest.adoptServerRest({ generation: 'watch-old', status: 'running', deadlineUtc: new Date(Date.now() - 1000).toISOString(), pausedRemainingMs: null, durationMs: 60_000, originDeviceId: 'watch' });
    expect(rest.current.generation).toBe('phone-1');
    rest.skip();
  });

  it('ends a rest it took from the server once another device skips it', () => {
    const rest = timer();
    rest.adoptServerRest({ generation: 'watch-1', status: 'running', deadlineUtc: inTwoMinutes(), pausedRemainingMs: null, durationMs: 120_000, originDeviceId: 'watch' });
    rest.adoptServerRest({ generation: null, status: 'idle', deadlineUtc: null, pausedRemainingMs: 0, durationMs: 0, originDeviceId: null });
    expect(rest.current.endsAt).toBe(0);
    expect(rest.current.generation).toBe('');
  });

  it('keeps a local rest the server has never seen when the server reads idle', () => {
    const rest = timer();
    rest.start(90, 'phone-unsent');
    rest.adoptServerRest({ generation: null, status: 'idle', deadlineUtc: null, pausedRemainingMs: 0, durationMs: 0, originDeviceId: null });
    expect(rest.current.generation).toBe('phone-unsent');
    rest.skip();
  });
});
