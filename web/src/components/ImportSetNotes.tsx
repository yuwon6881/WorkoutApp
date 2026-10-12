import type { DraftSet } from '../types';
import { setNoteText } from '../lib/importSetNotes';

/// Source notes for the sets that have any, listed under the set grid so no row changes height.
export function ImportSetNotes({ sets }: { sets: DraftSet[] }) {
  let warmups = 0;
  let working = 0;
  const items = sets.flatMap(set => {
    const number = set.warmup ? ++warmups : ++working;
    const text = setNoteText(set);
    return text ? [{ label: `${set.warmup ? 'Warm-up' : 'Set'} ${number}`, text }] : [];
  });
  if (!items.length) return null;
  return (
    <ul className="import-set-notes" aria-label="Set notes">
      {items.map(item => <li key={item.label}><strong>{item.label}</strong> {item.text}</li>)}
    </ul>
  );
}
