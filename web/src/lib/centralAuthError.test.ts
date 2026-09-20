import { describe, expect, it } from 'vitest';
import { centralAuthError, consumeCentralAuthError } from './centralAuthError';

describe('centralAuthError', () => {
  it('translates known OIDC errors into plain language', () => {
    expect(centralAuthError('access_denied')).toBe('Sign-in was cancelled. Try again when you are ready.');
  });

  it('does not expose unknown provider error codes', () => {
    expect(centralAuthError('provider_internal_code')).toBe('We could not complete sign-in. Please try again.');
  });

  it('explains when a delayed Nutrition callback lost a local disconnect race', () => {
    expect(centralAuthError('connection_changed')).toBe('Nutrition connection changed before setup completed. Try connecting again.');
  });

  it('consumes and cleans up access_denied cancellation parameters', () => {
    const url = new URL('https://workout.example/settings?central_error=access_denied&foo=bar');
    expect(consumeCentralAuthError(url)).toBe('Nutrition connection was canceled.');
    expect(url.searchParams.get('central_error')).toBeNull();
    expect(url.searchParams.get('foo')).toBe('bar');
  });

  it('consumes and cleans up error parameter fallback', () => {
    const url = new URL('https://workout.example/settings?error=access_denied');
    expect(consumeCentralAuthError(url)).toBe('Nutrition connection was canceled.');
    expect(url.searchParams.get('error')).toBeNull();
  });

  it('handles other central errors gracefully', () => {
    const url = new URL('https://workout.example/settings?central_error=server_error');
    expect(consumeCentralAuthError(url)).toBe('Could not connect Nutrition. Please try again.');
    expect(url.searchParams.get('central_error')).toBeNull();
  });

  it('explains when a delayed connection callback was invalidated by disconnect', () => {
    const url = new URL('https://workout.example/settings?central_error=connection_changed');
    expect(consumeCentralAuthError(url)).toBe('Nutrition connection changed before setup completed. Try connecting again.');
    expect(url.searchParams.get('central_error')).toBeNull();
  });

  it('returns null when no error is present in the URL', () => {
    const url = new URL('https://workout.example/settings');
    expect(consumeCentralAuthError(url)).toBeNull();
  });
});
