import type { RepMaxRecord } from '../types';
import { useTrackRir } from '../lib/trackRir';

/// The heaviest load lifted for a rep count (1, 3, 5, 8, 10; the server leaves out any that a larger
/// count already covers), each with the set behind it so a "5 reps" record done for six reps one rep
/// from failure reads as exactly that. Shown with the same table the progress rows use.
export function ExerciseRepMaxes({ repMaxes, formatDate, formatLoad }: {
  repMaxes: RepMaxRecord[];
  formatDate: (value: string) => string;
  formatLoad: (value: number | null | undefined) => string;
}) {
  const trackRir = useTrackRir();
  const showRir = trackRir && repMaxes.some(record => record.rir != null);
  const template = { gridTemplateColumns: `minmax(0, 1.3fr) repeat(${showRir ? 4 : 3}, minmax(0, 1fr))` };
  if (repMaxes.length === 0) return null;

  return <section aria-label="Best sets by reps">
    <div className="section-heading"><h3>Best sets by reps</h3></div>
    <p className="muted detail-note">
      Heaviest load lifted for at least that many reps{trackRir ? ', counting sets within 2 reps of failure' : ''}.
    </p>
    <div className="chart-table" role="table" aria-label="Best sets by reps">
      <div className="chart-table-row chart-table-head" role="row" style={template}>
        <span role="columnheader">Reps</span>
        <span role="columnheader">Load</span>
        <span role="columnheader">Done</span>
        {showRir && <span role="columnheader">RIR</span>}
        <span role="columnheader">Date</span>
      </div>
      {repMaxes.map(record => <div className="chart-table-row" role="row" style={template} key={record.reps}>
        <span role="cell" data-label="Reps">{record.reps === 1 ? '1 rep' : `${record.reps} reps`}</span>
        <span role="cell" data-label="Load">{formatLoad(record.loadKg)}</span>
        <span role="cell" data-label="Done">{record.actualReps}</span>
        {showRir && <span role="cell" data-label="RIR">{record.rir ?? '—'}</span>}
        <span role="cell" data-label="Date">{formatDate(record.date)}</span>
      </div>)}
    </div>
  </section>;
}
