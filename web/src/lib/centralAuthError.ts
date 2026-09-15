const messages: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. Try again when you are ready.',
  invalid_request: 'The sign-in request was not accepted. Try again.',
  login_required: 'Sign-in is required. Please try again.',
  interaction_required: 'The sign-in session needs your attention. Please try again.'
};

export function centralAuthError(code: string | null): string {
  return code ? messages[code] ?? 'We could not complete sign-in. Please try again.' : '';
}
