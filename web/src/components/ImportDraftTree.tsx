import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ChipScroller } from './ui/ChipScroller';
import { AddWeekModal, type AddWeekMode } from './AddWeekModal';
import { SortableWeekChip } from './SortableWeekChip';
import { DayRow } from './ImportDayRow';

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


function weekCaption(week: Week, number: number): string {
  const phase = week.phases.join(' / ') || 'General';
  return [`Block ${number}`, phase].filter(Boolean).join(' · ');
}

export const DraftOutline = forwardRef<DraftOutlineHandle, {
  draft: ImportDraft;
  expandedDay: string | null;
  setExpandedDay: (id: string | null) => void;
  exercises: Exercise[];
  onDayChange: (day: DraftWorkout) => Promise<void>;
  onDraftChange: (draft: ImportDraft) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}>(function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange, onDraftChange, restorableExerciseLineIds, onRestoreExercise }, ref) {
  const weeks = useMemo(() => groupWeeks(draft), [draft]);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]?.week ?? 1);
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [deleteConfirmWeek, setDeleteConfirmWeek] = useState<number | null>(null);
  const [draggedWeek, setDraggedWeek] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ week: number; side: 'before' | 'after' } | null>(null);
  const pendingFocusWeek = useRef<number | null>(null);

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

  useEffect(() => {
    if (pendingFocusWeek.current !== null) {
      const target = pendingFocusWeek.current;
      if (weeks.some(w => w.week === target)) {
        pendingFocusWeek.current = null;
        window.requestAnimationFrame(() => {
          const chip = document.querySelector<HTMLButtonElement>(`[data-import-week-chip="${target}"]`);
          chip?.focus();
          chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
      }
    }
  }, [weeks]);

  const week = weeks.find(entry => entry.week === selectedWeek) ?? weeks[0];
  if (!week) return null;
  const selectedIndex = weeks.findIndex(entry => entry.week === week.week);
  const selectedBlock = blockIndex(weeks, selectedIndex);

  const reorderWeeks = useCallback((from: number, to: number, side: 'before' | 'after' = 'before') => {
    if (from === to && side === 'before') {
      setDraggedWeek(null);
      setDropTarget(null);
      return;
    }
    const fromIndex = weeks.findIndex(entry => entry.week === from);
    const toIndex = weeks.findIndex(entry => entry.week === to);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedWeek(null);
      setDropTarget(null);
      return;
    }

    const insertionIndex = side === 'before' ? toIndex : toIndex + 1;
    const ordered = [...weeks];
    const [moved] = ordered.splice(fromIndex, 1);
    let targetIndex = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
    if (fromIndex < toIndex && side === 'before' && toIndex === fromIndex + 1) {
      targetIndex = toIndex;
    }
    ordered.splice(targetIndex, 0, moved);

    setSelectedWeek(targetIndex + 1);
    setDraggedWeek(null);
    setDropTarget(null);
    void onDraftChange(renumberDraft(draft, ordered));
  }, [draft, onDraftChange, weeks]);

  const addWeek = useCallback((mode: AddWeekMode) => {
    setWeekModalOpen(false);
    if (!weeks.length) return;

    const targetBlockWeeks = weeks.filter(w => w.block === week.block);
    const sourceWeek = mode === 'duplicate-current'
      ? week
      : (targetBlockWeeks.at(-1) ?? week);

    const sourceIndex = weeks.findIndex(w => w.week === sourceWeek.week);
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : weeks.length;

    const nextNumber = insertIndex + 1;
    const days = mode === 'empty'
      ? [emptyWeekDay(nextNumber, sourceWeek)]
      : cloneWeekDays(sourceWeek.days, nextNumber);

    const nextWeek: Week = {
      week: nextNumber,
      sourceWeek: nextNumber,
      days,
      block: sourceWeek.block || 'Program',
      phases: sourceWeek.phases.slice(0, 1),
      pages: []
    };

    const ordered = [...weeks];
    ordered.splice(insertIndex, 0, nextWeek);

    pendingFocusWeek.current = nextNumber;
    setSelectedWeek(nextNumber);
    void onDraftChange(renumberDraft(draft, ordered));
  }, [draft, onDraftChange, week, weeks]);

  const deleteWeek = useCallback((weekToDelete: number) => {
    if (weeks.length <= 1) return;
    const targetIndex = weeks.findIndex(w => w.week === weekToDelete);
    if (targetIndex < 0) return;

    const remainingWeeks = weeks.filter(w => w.week !== weekToDelete);
    const renumbered = renumberDraft(draft, remainingWeeks);

    const nextSelectedIndex = Math.min(targetIndex, remainingWeeks.length - 1);
    const nextSelectedWeek = nextSelectedIndex + 1;

    pendingFocusWeek.current = nextSelectedWeek;
    setSelectedWeek(nextSelectedWeek);
    void onDraftChange(renumbered);
  }, [draft, onDraftChange, weeks]);

  const propagateSubstitution = useCallback(async (currentName: string, replacementName: string, exerciseLineId?: string) => {
    const replacementLibraryExercise = exercises.find(
      e => e.name.toLowerCase() === replacementName.toLowerCase() || e.aliases.some(a => a.toLowerCase() === replacementName.toLowerCase())
    );
    const updatedWorkouts = draft.workouts.map(workout => {
      const inSameBlock = (workout.block || 'Program') === (week.block || 'Program');
      const inSamePhase = !week.phases.length || week.phases.includes(workout.phase ?? '');
      if (!inSameBlock || !inSamePhase || workout.week < week.week) return workout;

      const updatedExercises = workout.exercises.map(ex => {
        const matches = (exerciseLineId && ex.lineId === exerciseLineId)
          || ex.sourceName.toLowerCase() === currentName.toLowerCase()
          || (ex.exerciseId && exercises.find(e => e.id === ex.exerciseId)?.name.toLowerCase() === currentName.toLowerCase());
        if (matches) {
          const nextSubs = [ex.sourceName, ...ex.substitutions.filter(s => s.toLowerCase() !== replacementName.toLowerCase())].slice(0, 2);
          return {
            ...ex,
            sourceName: replacementLibraryExercise ? replacementLibraryExercise.name : replacementName,
            exerciseId: replacementLibraryExercise ? replacementLibraryExercise.id : null,
            substitutions: nextSubs
          };
        }
        return ex;
      });

      return { ...workout, exercises: updatedExercises };
    });

    await onDraftChange({ ...draft, workouts: updatedWorkouts });
  }, [draft, onDraftChange, week, exercises]);

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
      {weeks.map(entry => <SortableWeekChip key={entry.week} week={entry.week} selected={entry.week === week.week}
        dragging={draggedWeek === entry.week}
        dropSide={dropTarget?.week === entry.week && draggedWeek !== entry.week ? dropTarget.side : null}
        onSelect={() => setSelectedWeek(entry.week)}
        onDragStart={() => { setDraggedWeek(entry.week); setDropTarget(null); }}
        onDragOver={(weekNumber, side) => setDropTarget({ week: weekNumber, side })}
        onDrop={(weekNumber, side) => reorderWeeks(draggedWeek ?? entry.week, weekNumber ?? dropTarget?.week ?? entry.week, side ?? dropTarget?.side ?? 'before')} />)}
      <Button presentation="plain" className="filter-chip import-add-week-chip" aria-label="Add week" onClick={() => setWeekModalOpen(true)}>
        <Plus size={15} />Add week
      </Button>
    </ChipScroller>
    <div className="import-week-toolbar">
      <p className="import-week-caption">{weekCaption(week, selectedBlock)}</p>
      {weeks.length > 1 && (
        <Button
          variant="destructive"
          className="import-delete-week-btn"
          aria-label={`Delete week ${week.week}`}
          onClick={() => setDeleteConfirmWeek(week.week)}
        >
          <Trash2 size={14} /> Delete week
        </Button>
      )}
    </div>
    <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week}`}>
      {week.days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId}
        onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange}
        onPropagateSubstitution={propagateSubstitution}
        restorableExerciseLineIds={restorableExerciseLineIds}
        onRestoreExercise={onRestoreExercise} />)}
    </div>
    </section>
    <AddWeekModal
      open={weekModalOpen}
      onClose={() => setWeekModalOpen(false)}
      onAddWeek={addWeek}
      currentWeekNumber={week.week}
      blockName={week.block || `Block ${selectedBlock}`}
      phaseName={week.phases[0]}
    />
    {deleteConfirmWeek !== null && (
      <Modal title={`Delete Week ${deleteConfirmWeek}?`} onClose={() => setDeleteConfirmWeek(null)}>
        <div className="modal-body">
          <p>
            Are you sure you want to delete <strong>Week {deleteConfirmWeek}</strong>? All days and exercises in this week will be removed and subsequent weeks will be renumbered.
          </p>
          <div className="modal-actions">
            <Button variant="tertiary" onClick={() => setDeleteConfirmWeek(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = deleteConfirmWeek;
                setDeleteConfirmWeek(null);
                deleteWeek(target);
              }}
            >
              <Trash2 size={15} /> Delete week
            </Button>
          </div>
        </div>
      </Modal>
    )}
  </>;
});
