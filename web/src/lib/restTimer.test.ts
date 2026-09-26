import { describe, expect, it } from 'vitest';
import { isRestAlertOwner, shortenedRest } from './restTimer';

const alert = { sessionId: 'session-a', generation: 'generation-a' };
const owner = {
  accountId: 'account-a', sessionId: 'session-a', generation: 'generation-a',
  endsAt: 100, visible: true
};

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
