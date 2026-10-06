import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ExerciseHistoryRow, Session, Unit } from '../types';
import { ApiError } from '../lib/api';
import { loadSessionDetail } from '../lib/sessionDetailLoad';
import { showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { SessionExerciseList } from './SessionExerciseList';
import './SessionDetail.css';

function HistoryEntry({ row, exerciseId, unit }: { row: ExerciseHistoryRow; exerciseId: string; unit: Unit }) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try { setSession(await loadSessionDetail(row.sessionId)); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load the performed sets.'); }
    finally { setLoading(false); }
  }
  const date = new Date(row.finishedAt ?? `${row.date}T12:00:00`).toLocaleDateString('en', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  return <li className="exercise-history-entry">
    <Button variant="tertiary" className="history-row" aria-expanded={expanded}
      onClick={() => { setExpanded(!expanded); if (!expanded && !session && !loading) void load(); }}>
      <span className="row-title"><strong>{row.sessionName}</strong>
        <small>{row.programName ?? 'Standalone workout'}</small>
        <small>{date} · {showSetCount(row.setCount)}</small>
      </span>
      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </Button>
    {expanded && <div className="exercise-history-sets">
      {error ? <CardFeedback title="Performed sets unavailable" message={error}
        action={{ label: 'Retry', onClick: () => void load() }} />
        : <SessionExerciseList exercises={session?.exercises.filter(exercise => exercise.exerciseId === exerciseId) ?? []}
          unit={unit} loading={loading} heading="Performed sets" showCount={false} />}
    </div>}
  </li>;
}

export function ExerciseHistory({ rows, exerciseId, unit }: { rows: ExerciseHistoryRow[]; exerciseId: string; unit: Unit }) {
  return <ul className="exercise-history-list">
    {rows.map(row => <HistoryEntry key={row.sessionId} row={row} exerciseId={exerciseId} unit={unit} />)}
  </ul>;
}
