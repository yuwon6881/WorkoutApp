import { describe, expect, it } from 'vitest';
import { REST_OVER_MS, restPhase, restShareLeft } from './restDisplay';

const now = 1_000_000;

describe('restPhase', () => {
  it('reads a counting rest as running and a held one as paused', () => {
    expect(restPhase({ endsAt: now + 30_000, pausedRemainingMs: 0, totalSeconds: 90 }, now)).toBe('running');
    expect(restPhase({ endsAt: 0, pausedRemainingMs: 40_000, totalSeconds: 90 }, now)).toBe('paused');
  });

  it('says a rest that ran out is over, briefly', () => {
    expect(restPhase({ endsAt: now - 200, pausedRemainingMs: 0, totalSeconds: 90 }, now)).toBe('over');
    expect(restPhase({ endsAt: now - REST_OVER_MS, pausedRemainingMs: 0, totalSeconds: 90 }, now)).toBe('idle');
  });

  it('goes straight to idle when a rest is skipped', () => {
    expect(restPhase({ endsAt: 0, pausedRemainingMs: 0, totalSeconds: 0 }, now)).toBe('idle');
  });
});

describe('restShareLeft', () => {
  it('drains from one to zero over the rest', () => {
    expect(restShareLeft({ endsAt: now + 45_000, pausedRemainingMs: 0, totalSeconds: 90 }, now)).toBe(0.5);
    expect(restShareLeft({ endsAt: now - 1, pausedRemainingMs: 0, totalSeconds: 90 }, now)).toBe(0);
    expect(restShareLeft({ endsAt: 0, pausedRemainingMs: 0, totalSeconds: 0 }, now)).toBe(0);
  });
});
