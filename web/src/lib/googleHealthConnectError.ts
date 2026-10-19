/// Plain-language copy for the codes a Google Health connection attempt can end with, whether the
/// browser callback put them in the address or the Android app's handoff returned them.
const messages: Record<string, string> = {
  duplicate_account: 'This Google account is already linked to another Workout account. Each Google account can only connect once.',
  identity_change_requires_disconnect: 'This Workout account is already linked to a different Google account. Disconnect it before connecting another account.',
  session_mismatch: 'Your Workout session changed during connection. Please sign in and try again.',
  session_expired: 'Your Workout session changed during connection. Please sign in and try again.',
  access_denied: 'Access was denied in Google permissions.',
  invalid_state: 'Connection session expired. Please start the connection again.',
  identity_resolution_failed: 'Google granted access, but its account identity could not be confirmed. Try again, and contact support if it continues.',
  token_exchange_failed: 'Google could not finish the authorization exchange. Check the configured redirect URI and try again.',
  missing_tokens: 'Google did not return the required authorization tokens. Remove this app from your Google account and reconnect.',
  encryption_failed: 'Workout could not securely store the Google connection. Try again later.',
  missing_parameters: 'Google returned an incomplete authorization response. Please start the connection again.',
  provider_error: 'Google returned an unexpected authorization error. Please try again.'
};

export function describeGoogleHealthConnectError(code: string | null): string {
  return (code && messages[code]) || 'Google Health connection was not completed.';
}
