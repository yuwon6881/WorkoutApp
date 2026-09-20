import { describe, expect, it } from 'vitest';
import { connectedAppActions, parseConnectionState } from './connectedAppsState';

describe('connected app settings state', () => {
  it('treats unknown or absent status as temporarily unavailable', () => {
    expect(parseConnectionState(undefined)).toBe('temporary_unavailable');
    expect(parseConnectionState('future_state')).toBe('temporary_unavailable');
  });

  it('keeps legacy upgrade available while allowing explicit disconnect', () => {
    expect(connectedAppActions('upgrade_required', true)).toBe('reconnect_disconnect');
  });

  it('offers retry and disconnect when central status is temporarily unavailable', () => {
    expect(connectedAppActions('temporary_unavailable', true)).toBe('retry_disconnect');
  });
});
