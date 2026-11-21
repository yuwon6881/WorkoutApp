import { useState } from 'react';
import type { ExerciseMetricPoint } from '../types';
import { useTrackRir } from '../lib/trackRir';
import { Button } from './ui/Button';

const collapsedRows = 6;

type Column = { key: string; label: string; cell: (point: ExerciseMetricPoint) => string; present: (point: ExerciseMetricPoint) => boolean };

/// The per-session numbers behind the progress chart, newest first. A column no session has a
/// value for is left out rather than printed as a column of dashes, and a long history folds to
/// its latest sessions instead of becoming a second scroll area inside the dialog (the History
/// tab already lists every session).
export function ExerciseProgressTable({ points, formatDate, formatEstimate, formatLoad, formatVolume }: {
  points: ExerciseMetricPoint[];
  formatDate: (value: string) => string;
  /** An estimate, a logged load and a session total each read differently, so each has its own format. */
  formatEstimate: (value: number | null | undefined) => string;
  formatLoad: (value: number | null | undefined) => string;
  formatVolume: (value: number | null | undefined) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const trackRir = useTrackRir();
  const allColumns: Column[] = [
    { key: 'estimated1rm', label: '1RM', cell: p => formatEstimate(p.estimated1RmKg), present: p => p.estimated1RmKg != null },
    { key: 'load', label: 'Load', cell: p => formatLoad(p.loadKg), present: p => p.loadKg != null },
    { key: 'volume', label: 'Volume', cell: p => `${formatVolume(p.volumeKg)}${p.partial ? ' *' : ''}`, present: p => p.volumeKg != null },
    { key: 'reps', label: 'Reps', cell: p => String(p.reps ?? '—'), present: p => p.reps != null },
    // The 1RM estimate reads the reserve, so two rows with the same load and reps differ by it.
    { key: 'rir', label: 'RIR', cell: p => p.rir ?? '—', present: p => trackRir && p.rir != null }
  ];
  const columns = allColumns.filter(column => points.some(column.present));
  const newestFirst = [...points].reverse();
  const rows = expanded ? newestFirst : newestFirst.slice(0, collapsedRows);
  const summaryTracks: Record<string, string> = {
    estimated1rm: 'minmax(0, 1.1fr)', load: 'minmax(0, 1.1fr)', volume: 'minmax(0, 1.25fr)',
    reps: 'minmax(min-content, 0.65fr)', rir: 'minmax(min-content, 0.55fr)'
  };
  const template = { gridTemplateColumns: `minmax(0, 1.2fr) ${columns.map(column => summaryTracks[column.key]).join(' ')}` };

  return <section className="progress-table" aria-label="Session history">
    <div className="section-heading">
      <h3>Session history</h3>
      <span className="exercise-history-count">{newestFirst.length} {newestFirst.length === 1 ? "session" : "sessions"}</span>
    </div>
    <div className="chart-table" role="table" aria-label="Exercise progress table" style={template}>
      <div className="chart-table-row chart-table-head" role="row">
        <span role="columnheader">Date</span>
        {columns.map(column => <span role="columnheader" key={column.key}>{column.label}</span>)}
      </div>
      {rows.map(point => <div className="chart-table-row" role="row" key={`row-${point.sessionId}-${point.date}`}>
        <span role="cell" data-label="Date">{formatDate(point.date)}</span>
        {columns.map(column => <span role="cell" data-label={column.label} key={column.key} className={column.key === "load" ? "progress-cell-primary" : undefined}>{column.cell(point)}</span>)}
      </div>)}
    </div>
    {newestFirst.length > collapsedRows && <Button variant="tertiary" className="full-width" onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show fewer sessions' : `Show all ${newestFirst.length} sessions`}
    </Button>}
  </section>;
}
