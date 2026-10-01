import type { ImportView } from '../types';

export function isStoppedImport(view: ImportView): boolean {
  return view.status === 'failed' || ((view.status === 'pending' || view.status === 'ready') && Boolean(view.error));
}

/// The server lists newest first. Only live reads and ready drafts are resumed automatically;
/// a retained failure belongs to a past attempt until the user chooses to open it. `discarded`
/// covers imports thrown away on this screen that a list fetched before the discard still carries.
export function resumableImport(imports: readonly ImportView[], discarded: ReadonlySet<string> = new Set()): ImportView | null {
  return imports.find(view => (view.status === 'pending' || view.status === 'ready') && !view.error && !discarded.has(view.id)) ?? null;
}
