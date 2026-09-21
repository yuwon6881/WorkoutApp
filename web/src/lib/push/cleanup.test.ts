import { describe, expect, it } from 'vitest';
import { retireWorkoutPushAfterAccountSwitch, retireWorkoutPushDevice } from './cleanup';

describe('Workout push cleanup', () => {
  it('revokes the current account before deleting the local token and continues if revoke fails', async () => {
    const calls: string[] = [];

    await retireWorkoutPushDevice('phone-a', async () => {
      calls.push('revoke');
      throw new Error('session expired');
    }, async () => { calls.push('delete-token'); });

    expect(calls).toEqual(['revoke', 'delete-token']);
  });

  it('does not use the new account cleanup for an unchanged or unknown prior account', async () => {
    let calls = 0;
    const revoke = async () => { calls++; };
    const deleteToken = async () => { calls++; };

    expect(await retireWorkoutPushAfterAccountSwitch('account-a', 'account-a', 'phone-a', revoke, deleteToken)).toBe(false);
    expect(await retireWorkoutPushAfterAccountSwitch(null, 'account-b', 'phone-a', revoke, deleteToken)).toBe(false);
    expect(calls).toBe(0);
  });

  it('retires only the current device registration and token after an account switch', async () => {
    const calls: string[] = [];

    const changed = await retireWorkoutPushAfterAccountSwitch('account-a', 'account-b', 'phone-a', async () => {
      calls.push('revoke-current-account-device');
    }, async () => { calls.push('delete-token'); });

    expect(changed).toBe(true);
    expect(calls).toEqual(['revoke-current-account-device', 'delete-token']);
  });
});
