import type { ImportView } from '../types';

export function isStoppedImport(view: ImportView): boolean {
  return view.status === 'failed' || ((view.status === 'pending' || view.status === 'ready') && Boolean(view.error));
}

/// The server lists newest first. Only live reads and ready drafts are resumed automatically;
/// a retained failure belongs to a past attempt until the user chooses to open it.
export function resumableImport(imports: readonly ImportView[]): ImportView | null {
  return imports.find(view => (view.status === 'pending' || view.status === 'ready') && !view.error) ?? null;
}
