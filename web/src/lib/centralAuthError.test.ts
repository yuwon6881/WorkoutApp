import { describe, expect, it } from 'vitest';
import { centralAuthError } from './centralAuthError';

describe('centralAuthError', () => {
  it('translates known OIDC errors into plain language', () => {
    expect(centralAuthError('access_denied')).toBe('Sign-in was cancelled. Try again when you are ready.');
  });

  it('does not expose unknown provider error codes', () => {
    expect(centralAuthError('provider_internal_code')).toBe('We could not complete sign-in. Please try again.');
  });
});
