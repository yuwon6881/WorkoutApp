import { useState } from 'react';
import type { ExerciseMetricPoint } from '../types';
import { Button } from './ui/Button';

const collapsedRows = 6;

type Column = { key: string; label: string; cell: (point: ExerciseMetricPoint) => string; present: (point: ExerciseMetricPoint) => boolean };

/// The per-session numbers behind the progress chart, newest first. A column no session has a
/// value for is left out rather than printed as a column of dashes, and a long history folds to
/// its latest sessions instead of becoming a second scroll area inside the dialog (the History
/// tab already lists every session).
export function ExerciseProgressTable({ points, formatDate, formatKg }: {
  points: ExerciseMetricPoint[];
  formatDate: (value: string) => string;
  formatKg: (value: number | null | undefined) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const allColumns: Column[] = [
    { key: 'estimated1rm', label: '1RM', cell: p => formatKg(p.estimated1RmKg), present: p => p.estimated1RmKg != null },
    { key: 'load', label: 'Load', cell: p => formatKg(p.loadKg), present: p => p.loadKg != null },
    { key: 'volume', label: 'Volume', cell: p => `${formatKg(p.volumeKg)}${p.partial ? ' *' : ''}`, present: p => p.volumeKg != null },
    { key: 'reps', label: 'Reps', cell: p => String(p.reps ?? '—'), present: p => p.reps != null }
  ];
  const columns = allColumns.filter(column => points.some(column.present));
  const has1Rm = columns.some(column => column.key === 'estimated1rm');
  const newestFirst = [...points].reverse();
  const rows = expanded ? newestFirst : newestFirst.slice(0, collapsedRows);
  const template = { gridTemplateColumns: `minmax(0, 1.3fr) repeat(${columns.length}, minmax(0, 1fr))` };

  return <div>
    <div className="chart-table" role="table" aria-label="Exercise progress table">
      <div className="chart-table-row chart-table-head" role="row" style={template}>
        <span role="columnheader">Date</span>
        {columns.map(column => <span role="columnheader" key={column.key}>{column.label}</span>)}
      </div>
      {rows.map(point => <div className="chart-table-row" role="row" style={template} key={`row-${point.sessionId}-${point.date}`}>
        <span role="cell">{formatDate(point.date)}</span>
        {columns.map(column => <span role="cell" key={column.key}>{column.cell(point)}</span>)}
      </div>)}
    </div>
    {has1Rm && <p className="chart-table-note">Estimated 1RM counts reps left in reserve when you log them. With no effort logged, the reps are taken as performed.</p>}
    {newestFirst.length > collapsedRows && <Button variant="tertiary" className="full-width" onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show fewer sessions' : `Show all ${newestFirst.length} sessions`}
    </Button>}
  </div>;
}
