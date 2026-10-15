export function recordedSync(accountId: string): string | null {
  try { return localStorage.getItem(`last-confirmed-sync:${accountId}`); } catch { return null; }
}
export function recordConfirmedSync(accountId: string): void {
  try { localStorage.setItem(`last-confirmed-sync:${accountId}`, new Date().toISOString()); } catch { /* Advisory diagnostics only. */ }
}
