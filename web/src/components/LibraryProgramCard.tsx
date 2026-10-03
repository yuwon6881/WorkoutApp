import { useEffect, useState, type HTMLAttributes } from 'react';
import { Trash2, Zap } from 'lucide-react';
import type { Exercise, ImportDraft, ProgramSummary } from '../types';
import { ApiError, api } from '../lib/api';
import { programToDraft } from '../lib/activeSlot';
import { MenuItem } from './ui/MenuButton';
import { DraftOutline } from './ImportDraftTree';
import { SlotCardHeader } from './SlotCardHeader';

/// A saved program waiting in the library: one line until expanded, then the same block and
/// week timeline the builder uses, view-only. It carries no run state; that only exists while a
/// program holds the active slot.
export function LibraryProgramCard({ program, exercises, busy, onActivate, onDelete, dragProps, dragging }: {
  program: ProgramSummary;
  exercises: Exercise[];
  busy: boolean;
  onActivate: () => void;
  onDelete: () => void;
  dragProps: HTMLAttributes<HTMLElement>;
  dragging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const weekCount = new Set(program.days.map(day => day.week)).size;
  const workoutDays = program.days.filter(day => !day.isRestDay).length;

  // A tall card is hard to carry across the page, so lifting it folds it down to its header.
  useEffect(() => { if (dragging) setExpanded(false); }, [dragging]);

  async function toggle() {
    if (!expanded && draft === null) {
      setLoading(true); setError('');
      try { setDraft(programToDraft(await api.getProgram(program.id))); }
      catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load this program.'); }
      finally { setLoading(false); }
    }
    setExpanded(value => !value);
  }

  return <section {...dragProps} className={`panel slot-card library-program-card ${expanded ? 'expanded' : ''}`} aria-busy={loading}>
    <SlotCardHeader title={program.name}
      meta={`${weekCount} ${weekCount === 1 ? 'week' : 'weeks'} · ${workoutDays} workout ${workoutDays === 1 ? 'day' : 'days'}`}
      expanded={expanded} onToggle={() => void toggle()}
      menuLabel={`Actions for ${program.name}`}
      menu={<>
        <MenuItem disabled={busy} onClick={onActivate}><Zap size={14} />Make active</MenuItem>
        <MenuItem destructive disabled={busy} onClick={onDelete}><Trash2 size={14} />Delete program</MenuItem>
      </>} />
    {expanded && loading && <p className="muted small-copy" role="status">Loading program…</p>}
    {expanded && draft && <DraftOutline draft={draft} expandedDay={openDay} setExpandedDay={setOpenDay} exercises={exercises}
      onDayChange={async () => {}} onDraftChange={async next => setDraft(next)} readOnly />}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
