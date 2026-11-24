export type ExternalImportFieldError = { path: string; message: string };

/// Keeps only well-formed entries from an untrusted error payload.
export function readFieldErrors(payload: unknown): ExternalImportFieldError[] {
  if (!payload || typeof payload !== 'object' || !('errors' in payload) || !Array.isArray(payload.errors)) return [];
  return payload.errors.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { path, message } = item as Record<string, unknown>;
    return typeof path === 'string' && typeof message === 'string' ? [{ path, message }] : [];
  });
}
