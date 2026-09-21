import { describe, expect, it } from 'vitest';
import { isRestAlertOwner } from './restTimer';

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
