import type { DraftSet } from '../types';
import { setNoteItems } from '../lib/importSetNotes';

/// Source notes for the sets that have any, listed under the set grid so no row changes height.
export function ImportSetNotes({ sets }: { sets: DraftSet[] }) {
  const items = setNoteItems(sets);
  if (!items.length) return null;
  return (
    <ul className="import-set-notes" aria-label="Set notes">
      {items.map(item => <li key={item.label}><strong>{item.label}</strong><span>{item.text}</span></li>)}
    </ul>
  );
}
