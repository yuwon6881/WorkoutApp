import type { ImportView } from '../types';

/// A saved import the lifter can pick back up: a draft ready for review, or one waiting for the
/// choice between program or week versions. Anything else (a leftover from an earlier importer
/// that stopped part-way) has nothing to show and is never opened.
function isResumable(view: ImportView): boolean {
  if (view.error) return false;
  return view.status === 'ready' || (view.status === 'pending' && view.stage === 'select' && Boolean(view.alternatives?.length));
}

/// The server lists newest first. `discarded` covers imports thrown away on this screen that a
/// list fetched before the discard still carries.
export function resumableImport(imports: readonly ImportView[], discarded: ReadonlySet<string> = new Set()): ImportView | null {
  return imports.find(view => isResumable(view) && !discarded.has(view.id)) ?? null;
}
