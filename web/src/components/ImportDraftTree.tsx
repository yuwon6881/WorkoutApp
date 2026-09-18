import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Copy, Pencil, Plus } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { ChipScroller } from './ui/ChipScroller';
import { DayEditor, exerciseSummary } from './ImportDayEditor';
import { getWorkoutMuscles } from '../lib/muscles';
import { Modal } from './ui/Modal';

type Week = {
  week: number;
  sourceWeek: number;
  days: DraftWorkout[];
  block: string;
  phases: string[];
  pages: number[];
};

export type ImportIssueTarget = {
  sourcePage?: number | null;
  workoutLineId?: string | null;
  exerciseLineId?: string | null;
  setIndex?: number | null;
  targetField?: string | null;
};

export type DraftOutlineHandle = {
  focusIssue: (target: ImportIssueTarget) => void;
};

function sourcePages(days: DraftWorkout[]): number[] {
  const pages = days.flatMap(day => [
    day.sourcePage,
    ...day.exercises.flatMap(exercise => [exercise.sourcePage, ...exercise.sets.map(set => set.sourcePage)])
  ]);
  return [...new Set(pages.filter((page): page is number => page != null))].sort((left, right) => left - right);
}

function groupWeeks(draft: ImportDraft): Week[] {
  const grouped = new Map<number, Week>();
  for (const day of draft.workouts) {
    const current = grouped.get(day.week);
    if (current) {
      current.days.push(day);
      if (day.phase && !current.phases.includes(day.phase)) current.phases.push(day.phase);
      continue;
    }
    grouped.set(day.week, {
      week: day.week,
      sourceWeek: day.week,
      days: [day],
      block: day.block || 'Program',
      phases: day.phase ? [day.phase] : [],
      pages: []
    });
  }
  return [...grouped.values()]
    .sort((left, right) => left.week - right.week)
    .map((week, index) => ({
      ...week,
      sourceWeek: week.week,
      week: index + 1,
      pages: sourcePages(week.days)
    }));
}

function renumberDraft(draft: ImportDraft, orderedWeeks: Week[]): ImportDraft {
  const phasePositions = new Map<string, { week: number; position: number }>();
  const workouts = orderedWeeks.flatMap((entry, index) => entry.days.map(day => {
    const week = index + 1;
    if (!day.phase) return { ...day, week };
    const key = `${day.block?.trim() ?? ''}\u001f${day.phase.trim()}`;
    const previous = phasePositions.get(key);
    const position = previous?.week === week ? previous.position : (previous?.position ?? 0) + 1;
    phasePositions.set(key, { week, position });
    return { ...day, week, phaseWeek: position };
  }));
  return { ...draft, workouts };
}

function cloneSet(set: DraftSet): DraftSet {
  return {
    ...set,
    sourcePage: null,
    repsSource: 'userEdited',
    rpeSource: 'userEdited',
    restSource: 'userEdited'
  };
}

function cloneExercise(exercise: DraftExercise): DraftExercise {
  return { ...exercise, lineId: crypto.randomUUID(), sourcePage: null, sets: exercise.sets.map(cloneSet) };
}

function cloneWeekDays(days: DraftWorkout[], week: number): DraftWorkout[] {
  return days.map(day => ({
    ...day,
    lineId: crypto.randomUUID(),
    week,
    phaseWeek: day.phaseWeek + 1,
    sourcePage: null,
    exercises: day.exercises.map(cloneExercise)
  }));
}

function emptyWeekDay(week: number, latest: Week | undefined): DraftWorkout {
  return {
    lineId: crypto.randomUUID(),
    week,
    name: 'New day',
    focus: null,
    notes: null,
    exercises: [blankExercise()],
    block: latest?.block ?? 'Program',
    phase: latest?.phases[0] ?? null,
    phaseWeek: (latest?.days[0]?.phaseWeek ?? 0) + 1,
    isRestDay: false,
    weekday: null,
    sourcePage: null
  };
}

function blankExercise(): DraftExercise {
  const set: DraftSet = {
    repMin: 8,
    repMax: 12,
    targetRpe: 8,
    restSeconds: 90,
    tempo: null,
    loadText: null,
    notes: null,
    repsSource: 'userEdited',
    rpeSource: 'userEdited',
    restSource: 'userEdited',
    repsText: null,
    restText: null,
    rir: null,
    warmup: false
  };
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sets: [set], sequenceGroup: '', substitutions: [] };
}

function blockIndex(weeks: Week[], index: number): number {
  let result = 0;
  let previous = '';
  for (let current = 0; current <= index; current++) {
    if (weeks[current].block !== previous) {
      result++;
      previous = weeks[current].block;
    }
  }
  return result;
}

function sourceCaption(pages: number[]): string {
  if (!pages.length) return '';
  const first = pages[0];
  const last = pages.at(-1)!;
  return first === last ? `PDF p.${first}` : `PDF pp. ${first}-${last}`;
}

function weekCaption(week: Week, number: number): string {
  const phase = week.phases.join(' / ') || 'General';
  const source = sourceCaption(week.pages);
  return [`Block ${number}`, phase, source].filter(Boolean).join(' · ');
}

export const DraftOutline = forwardRef<DraftOutlineHandle, {
  draft: ImportDraft;
  expandedDay: string | null;
  setExpandedDay: (id: string | null) => void;
  exercises: Exercise[];
  onDayChange: (day: DraftWorkout) => Promise<void>;
  onDraftChange: (draft: ImportDraft) => Promise<void>;
}>(function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange, onDraftChange }, ref) {
  const weeks = useMemo(() => groupWeeks(draft), [draft]);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]?.week ?? 1);
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [draggedWeek, setDraggedWeek] = useState<number | null>(null);
  const [dropWeek, setDropWeek] = useState<number | null>(null);

  const focusIssue = useCallback((target: ImportIssueTarget) => {
    const day = draft.workouts.find(candidate => candidate.lineId === target.workoutLineId)
      ?? draft.workouts.find(candidate => candidate.exercises.some(exercise => exercise.lineId === target.exerciseLineId))
      ?? (target.sourcePage == null ? undefined : draft.workouts.find(candidate => candidate.sourcePage === target.sourcePage
        || candidate.exercises.some(exercise => exercise.sourcePage === target.sourcePage
          || exercise.sets.some(set => set.sourcePage === target.sourcePage))))
      ?? draft.workouts.find(candidate => !candidate.isRestDay)
      ?? draft.workouts[0];
    if (!day) return;
    const displayWeek = weeks.find(entry => entry.sourceWeek === day.week)?.week ?? day.week;
    setSelectedWeek(displayWeek);
    setExpandedDay(day.lineId);

    const reveal = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const dayNode = [...document.querySelectorAll<HTMLElement>('[data-import-day]')]
        .find(node => node.dataset.importDay === day.lineId);
      if (!dayNode) return;
      const weekNode = [...document.querySelectorAll<HTMLElement>('[data-import-week-chip]')]
        .find(node => node.dataset.importWeekChip === String(displayWeek));
      const exerciseNode = target.exerciseLineId
        ? [...dayNode.querySelectorAll<HTMLElement>('[data-import-exercise]')]
          .find(node => node.dataset.importExercise === target.exerciseLineId)
        : null;
      const scope = exerciseNode ?? dayNode;
      const fields = [...scope.querySelectorAll<HTMLElement>('[data-import-field]')]
        .filter(node => !target.targetField || node.dataset.importField === target.targetField)
        .filter(node => target.setIndex == null || node.dataset.importSetIndex === String(target.setIndex));
      const field = fields[0];
      const control = field?.matches('input,button,textarea,[tabindex]')
        ? field
        : field?.querySelector<HTMLElement>('input,button,textarea,[tabindex]');
      const destination = target.targetField === 'week' ? weekNode ?? scope : control ?? field ?? scope;
      destination.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      control?.focus({ preventScroll: true });
      const highlight = target.targetField === 'week' ? weekNode ?? dayNode : field ?? exerciseNode ?? dayNode;
      highlight.classList.add('issue-focus');
      window.setTimeout(() => highlight.classList.remove('issue-focus'), 1800);
    }));
    reveal();
  }, [draft.workouts, setExpandedDay, weeks]);

  useImperativeHandle(ref, () => ({ focusIssue }), [focusIssue]);

  const blocks = useMemo(() => {
    const list: { name: string; number: number; weeks: Week[] }[] = [];
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      const num = blockIndex(weeks, i);
      let b = list.find(item => item.name === w.block);
      if (!b) {
        b = { name: w.block, number: num, weeks: [] };
        list.push(b);
      }
      b.weeks.push(w);
    }
    return list;
  }, [weeks]);

  useEffect(() => {
    setSelectedWeek(current => {
      if (weeks.some(week => week.week === current)) return current;
      const first = weeks[0];
      if (!first) return 1;
      return weeks.reduce((nearest, candidate) =>
        Math.abs(candidate.week - current) < Math.abs(nearest.week - current) ? candidate : nearest,
        first).week;
    });
  }, [weeks]);

  const week = weeks.find(entry => entry.week === selectedWeek) ?? weeks[0];
  if (!week) return null;
  const selectedIndex = weeks.findIndex(entry => entry.week === week.week);
  const selectedBlock = blockIndex(weeks, selectedIndex);

  const reorderWeeks = useCallback((from: number, to: number) => {
    if (from === to) return;
    const fromIndex = weeks.findIndex(entry => entry.week === from);
    const toIndex = weeks.findIndex(entry => entry.week === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const ordered = [...weeks];
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    setSelectedWeek(toIndex + 1);
    setDraggedWeek(null);
    setDropWeek(null);
    void onDraftChange(renumberDraft(draft, ordered));
  }, [draft, onDraftChange, weeks]);

  const addWeek = useCallback((mode: 'copy' | 'empty') => {
    const latest = weeks.at(-1);
    if (!latest) return;
    const nextNumber = weeks.length + 1;
    const days = mode === 'copy'
      ? cloneWeekDays(latest.days, nextNumber)
      : [emptyWeekDay(nextNumber, latest)];
    const nextWeek: Week = {
      week: nextNumber,
      sourceWeek: nextNumber,
      days,
      block: mode === 'copy' ? latest.block : latest.block || 'Program',
      phases: mode === 'copy' ? latest.phases : latest.phases.slice(0, 1),
      pages: []
    };
    setWeekModalOpen(false);
    setSelectedWeek(nextNumber);
    void onDraftChange(renumberDraft(draft, [...weeks, nextWeek]));
  }, [draft, onDraftChange, weeks]);

  return <>
    <section className="panel import-program-card">
    <div className="section-heading import-program-heading">
      <div className="import-program-title">
        <span className="import-program-icon" aria-hidden="true"><CalendarDays size={18} /></span>
        <div>
          <span className="import-program-kicker">Program timeline</span>
          <h2>{draft.programName}</h2>
        </div>
      </div>
      <span className="import-week-count">{weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</span>
    </div>
    {blocks.length > 1 && <div className="import-block-selector" role="tablist" aria-label="Program blocks">
      {blocks.map(b => {
        const isSelected = b.weeks.some(w => w.week === week.week);
        return <Button key={b.name} presentation="plain" role="tab" aria-selected={isSelected}
          className={`filter-chip ${isSelected ? 'active' : ''}`}
          onClick={() => setSelectedWeek(b.weeks[0]?.week ?? week.week)}>
          Block {b.number}{b.name && b.name !== `Block ${b.number}` && b.name !== 'Program' ? ` · ${b.name}` : ''}
        </Button>;
      })}
    </div>}
    <div className="import-weeks-heading">
      <span>Weeks</span>
      <span className="muted">Swipe or use the arrows to browse the plan</span>
    </div>
    <ChipScroller ariaLabel="Program weeks" role="tablist" resetKey={weeks.map(entry => entry.week).join('|')}
      leftLabel="Scroll program weeks left" rightLabel="Scroll program weeks right">
      {weeks.map(entry => <SortableWeekChip key={entry.week} entry={entry} selected={entry.week === week.week}
        dragging={draggedWeek === entry.week} dropTarget={dropWeek === entry.week && draggedWeek !== entry.week}
        onSelect={() => setSelectedWeek(entry.week)} onDragStart={() => { setDraggedWeek(entry.week); setDropWeek(entry.week); }}
        onDragOver={weekNumber => setDropWeek(weekNumber)} onDrop={weekNumber => reorderWeeks(draggedWeek ?? entry.week, weekNumber ?? dropWeek ?? entry.week)} />)}
      <Button presentation="plain" className="filter-chip import-add-week-chip" aria-label="Add week" onClick={() => setWeekModalOpen(true)}>
        <Plus size={15} />Add week
      </Button>
    </ChipScroller>
    <p className="import-week-caption">{weekCaption(week, selectedBlock)}</p>
    <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week}`}>
      {week.days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId}
        onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange} />)}
    </div>
    </section>
    {weekModalOpen && <Modal title="Add a week" onClose={() => setWeekModalOpen(false)}>
      <div className="modal-body week-create-options">
        <p>Choose how the new week should start. You can edit its days after it is added.</p>
        <Button variant="secondary" className="week-create-option" onClick={() => addWeek('copy')}>
          <Copy size={17} /><span><strong>Copy the latest block</strong><small>Start with the latest block’s most recent week and its day structure.</small></span>
        </Button>
        <Button variant="secondary" className="week-create-option" onClick={() => addWeek('empty')}>
          <Plus size={17} /><span><strong>Start empty</strong><small>Add a blank training day that you can name, map and prescribe.</small></span>
        </Button>
      </div>
    </Modal>}
  </>;
});

function SortableWeekChip({ entry, selected, dragging, dropTarget, onSelect, onDragStart, onDragOver, onDrop }: {
  entry: Week;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (week: number) => void;
  onDrop: (week?: number) => void;
}) {
  const pointer = useRef<{ id: number; startX: number; startY: number; armed: boolean; moved: boolean; timer?: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);

  const clearPointer = () => {
    const current = pointer.current;
    if (current?.timer != null) window.clearTimeout(current.timer);
    pointer.current = null;
  };

  return <Button ref={chipRef} presentation="plain" role="tab" aria-selected={selected} draggable
    data-import-week-chip={entry.week}
    className={`filter-chip import-week-chip ${selected ? 'active' : ''} ${dragging ? 'dragging' : ''} ${dropTarget ? 'drop-target' : ''}`}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(); }}
    onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
    onDragOver={event => { event.preventDefault(); onDragOver(entry.week); }}
    onDrop={event => { event.preventDefault(); onDrop(entry.week); }}
    onDragEnd={() => { clearPointer(); suppressClick.current = false; onDrop(); }}
    onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const current: { id: number; startX: number; startY: number; armed: boolean; moved: boolean; timer?: number } = { id: event.pointerId, startX: event.clientX, startY: event.clientY, armed: false, moved: false };
      current.timer = window.setTimeout(() => {
        if (pointer.current?.id !== current.id || current.moved) return;
        current.armed = true;
        onDragStart();
        try { chipRef.current?.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      }, 240);
      pointer.current = current;
    }}
    onPointerMove={event => {
      const current = pointer.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (!current.armed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
          current.moved = true;
          if (current.timer != null) window.clearTimeout(current.timer);
          if (Math.abs(dy) >= Math.abs(dx)) clearPointer();
        }
        return;
      }
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-import-week-chip]');
      if (target?.dataset.importWeekChip) onDragOver(Number(target.dataset.importWeekChip));
    }}
    onPointerUp={event => {
      const current = pointer.current;
      if (!current || current.id !== event.pointerId) return;
      if (current.armed) {
        suppressClick.current = true;
        onDrop();
      }
      clearPointer();
    }}
    onPointerCancel={clearPointer}>
    Week {entry.week}
  </Button>;
}

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function DayLines({ day }: { day: DraftWorkout }) {
  return <ol className="draft-day-lines">
    {day.exercises.map(exercise => <li key={exercise.lineId}>
      {exercise.sequenceGroup && <span className="draft-line-group">{exercise.sequenceGroup}</span>}
      <span className="draft-line-name">{exercise.sourceName}</span>
      <span className="draft-line-detail">{exerciseSummary(exercise)}</span>
    </li>)}
  </ol>;
}

function DayRow({ day, expanded, onToggle, exercises, onChange }: {
  day: DraftWorkout;
  expanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const muscles = useMemo(() => getWorkoutMuscles(day.exercises, exercises), [day.exercises, exercises]);
  const exercisePreview = useMemo(() => {
    if (day.isRestDay || !day.exercises.length) return '';
    const names = day.exercises.map(e => e.sourceName);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [day.exercises, day.isRestDay]);

  const fullName = `${day.weekday ? `${weekdayNames[day.weekday - 1]} · ` : ''}${day.name}`;

  return <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`} data-import-day={day.lineId}>
    <div className="draft-day-card-header">
      <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} aria-label={fullName} onClick={onToggle}>
        <span className={`draft-day-disclosure ${expanded ? 'open' : ''}`} aria-hidden="true"><ChevronDown size={17} /></span>
        <div className="draft-day-title-group">
          <strong>{fullName}</strong>
          <div className="draft-day-meta-tags">
            <span className="tiny-label">{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}</span>
            {day.focus && <span className="day-focus-tag">{day.focus}</span>}
            {day.phase?.toLowerCase().includes('deload') && <span className="pill pill-accent">Deload</span>}
            {day.sourcePage && <span className="muted">PDF p.{day.sourcePage}</span>}
          </div>
        </div>
      </Button>
      <div className="draft-day-actions">
        {day.isRestDay ? <span className="tiny-label rest-badge">Rest day</span> : <>
          <Button variant="secondary" className="day-action-button" aria-label={`Edit ${day.name}`} onClick={onToggle}>
            <Pencil size={14} /><span>{expanded ? 'Close' : 'Edit'}</span>
          </Button>
          {!expanded && day.exercises.length > 0 && <Button variant="tertiary" className="day-chevron-button"
            aria-label={showDetails ? `Hide details for ${day.name}` : `View details for ${day.name}`}
            onClick={e => { e.stopPropagation(); setShowDetails(s => !s); }}>
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>}
        </>}
      </div>
    </div>

    {!expanded && !day.isRestDay && (
      <div className="draft-day-compact-body">
        {exercisePreview && <p className="day-exercise-preview">{exercisePreview}</p>}
        {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
          {muscles.slice(0, 5).map(m => <span key={m} className="muscle-chip">{m}</span>)}
          {muscles.length > 5 && <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>+{muscles.length - 5}</span>}
        </div>}
      </div>
    )}

    {!expanded && showDetails && !day.isRestDay && day.exercises.length > 0 && <DayLines day={day} />}
    {expanded && <DayEditor day={day} exercises={exercises} onChange={onChange} />}
  </section>;
}
