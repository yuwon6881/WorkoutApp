import { expect, it } from 'vitest';
import { ViewReadCache } from './viewReadCache';

it('separates accounts and versions and retires all snapshots on sign-out', () => {
  const cache = new ViewReadCache();
  cache.set('a:history', 'v1', { sessions: ['a'] });
  expect(cache.get('b:history', 'v1')).toBeUndefined();
  expect(cache.get('a:history', 'v2')).toBeUndefined();
  expect(cache.get('a:history', 'v1')).toEqual({ sessions: ['a'] });
  expect(cache.fresh('a:history', 'v1', Date.now() + 31_000)).toBe(false);
  cache.reset();
  expect(cache.get('a:history', 'v1')).toBeUndefined();
});
