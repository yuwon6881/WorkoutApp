import { useEffect, useMemo, useState, type HTMLAttributes } from 'react';
import { Pencil, Trash2, Zap } from 'lucide-react';
import type { Exercise, ProgramSummary } from '../types';
import { api } from '../lib/api';
import { programToDraft } from '../lib/activeSlot';
import { MenuItem } from './ui/MenuButton';
import { DraftOutline } from './ImportDraftTree';
import { SlotCardHeader } from './SlotCardHeader';
import { useCachedViewRead } from './useCachedViewRead';

/// A saved program waiting in the library: one line until expanded, then the same block and
/// week timeline the builder uses, view-only; Edit program opens it in the editor. It carries no
/// run state, so nothing in it is locked; that only exists while a program holds the active slot.
export function LibraryProgramCard({ program, exercises, busy, onActivate, onEdit, onDelete, dragProps, dragging }: {
  program: ProgramSummary;
  exercises: Exercise[];
  busy: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dragProps: HTMLAttributes<HTMLElement>;
  dragging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const detail = useCachedViewRead(`program:${program.id}`, program.revision,
    signal => api.getProgram(program.id, signal), expanded && Boolean(program.id));
  const draft = useMemo(() => detail.value ? programToDraft(detail.value) : null, [detail.value]);
  const loading = expanded && detail.loading;
  const error = expanded ? detail.error : '';
  const weekCount = new Set(program.days.map(day => day.week)).size;
  const workoutDays = program.days.filter(day => !day.isRestDay).length;

  // A tall card is hard to carry across the page, so lifting it folds it down to its header.
  useEffect(() => { if (dragging) setExpanded(false); }, [dragging]);

  // Saved programs waiting in the library are collapsed by default.
  useEffect(() => {
    setExpanded(false);
  }, [program.id]);

  return <section {...dragProps} className={`panel slot-card library-program-card ${expanded ? 'expanded' : ''}`} aria-busy={loading}>
    <SlotCardHeader title={program.name}
      meta={`${weekCount} ${weekCount === 1 ? 'week' : 'weeks'} · ${workoutDays} workout ${workoutDays === 1 ? 'day' : 'days'}`}
      expanded={expanded} onToggle={() => setExpanded(value => !value)}
      menuLabel={`Actions for ${program.name}`}
      menu={<>
        <MenuItem disabled={busy} onClick={onActivate}><Zap size={14} />Make active</MenuItem>
        <MenuItem disabled={busy} onClick={onEdit}><Pencil size={14} />Edit program</MenuItem>
        <MenuItem destructive disabled={busy} onClick={onDelete}><Trash2 size={14} />Delete program</MenuItem>
      </>} />
    {loading && !draft && <p className="muted small-copy" role="status">Loading program…</p>}
    {expanded && draft && <DraftOutline draft={draft} expandedDay={openDay} setExpandedDay={setOpenDay} exercises={exercises}
      onDayChange={async () => {}} onDraftChange={async () => {}} readOnly />}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
