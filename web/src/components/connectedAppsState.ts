export type ConnectionState = 'loading' | 'connected' | 'temporary_unavailable' | 'reconnect_required' | 'upgrade_required' | 'disconnected';
export type ConnectedAppActions = 'checking' | 'retry' | 'retry_disconnect' | 'connect' | 'reconnect' | 'reconnect_disconnect' | 'disconnect';

export function parseConnectionState(value: string | undefined): Exclude<ConnectionState, 'loading'> {
  return value === 'connected' || value === 'reconnect_required' || value === 'upgrade_required'
    || value === 'disconnected' || value === 'temporary_unavailable'
    ? value
    : 'temporary_unavailable';
}

export function connectedAppActions(state: ConnectionState, canDisconnect: boolean, syncWarning = false): ConnectedAppActions {
  if (state === 'loading') return 'checking';
  // A confirmed connection whose last data refresh failed stays connected; retry re-fetches.
  if (state === 'connected' && syncWarning) return canDisconnect ? 'retry_disconnect' : 'retry';
  if (state === 'temporary_unavailable') return canDisconnect ? 'retry_disconnect' : 'retry';
  if (state === 'upgrade_required' || state === 'reconnect_required')
    return canDisconnect ? 'reconnect_disconnect' : 'reconnect';
  if (state === 'connected') return 'disconnect';
  return 'connect';
}
