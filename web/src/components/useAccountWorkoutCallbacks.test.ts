import { expect, it, vi } from 'vitest';
import { useAccountWorkoutCallbacks } from './useAccountWorkoutCallbacks';
import type { Session } from '../types';

vi.mock('react', () => ({ useMemo: <T>(create: () => T) => create() }));
it('suppresses late workout results after switching accounts, while allowing results for the current account', () => {
  let current = 'owner';
  const callbacks = { onSaved: vi.fn(), onFinish: vi.fn(), onDiscard: vi.fn(), onRecoveryChange: vi.fn() };
  const guarded = useAccountWorkoutCallbacks('owner', id => id === current, callbacks);
  const saved = { id: 'workout' } as Session;
  guarded.onSaved(saved);
  expect(callbacks.onSaved).toHaveBeenCalledOnce();
  current = 'another-account';
  guarded.onSaved(saved); guarded.onFinish(saved); guarded.onDiscard(); guarded.onRecoveryChange(null);
  expect(callbacks.onSaved).toHaveBeenCalledOnce();
  expect(callbacks.onFinish).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
  expect(callbacks.onRecoveryChange).not.toHaveBeenCalled();
});
