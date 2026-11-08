import type { ImportDraft, ImportSourceReference } from '../types';

function describe(reference: ImportSourceReference | null | undefined): string | null {
  if (!reference || reference.kind === 'none') return null;
  if (reference.kind === 'pdfPage') return `PDF page ${reference.page}`;
  if (reference.kind === 'sheetCell') return `${reference.sheet}: ${reference.cell}`;
  return reference.text;
}

export function ImportSourceReferences({ draft }: { draft: ImportDraft }) {
  const rows: { key: string; text: string }[] = [];
  for (const day of draft.workouts) {
    const source = describe(day.sourceReference);
    if (source) rows.push({ key: day.lineId, text: `${day.name}: ${source}` });
    for (const exercise of day.exercises) {
      const exerciseSource = describe(exercise.sourceReference);
      if (exerciseSource) rows.push({ key: exercise.lineId, text: `${day.name} — ${exercise.sourceName}: ${exerciseSource}` });
      exercise.sets.forEach((set, index) => {
        const setSource = describe(set.sourceReference);
        if (setSource) rows.push({ key: `${exercise.lineId}-${index}`, text: `${day.name} — ${exercise.sourceName}, set ${index + 1}: ${setSource}` });
      });
    }
  }
  if (rows.length === 0) return null;
  return <details className="irev-source-references">
    <summary>Source references ({rows.length})</summary>
    <ul>{rows.map(row => <li key={row.key}>{row.text}</li>)}</ul>
  </details>;
}
