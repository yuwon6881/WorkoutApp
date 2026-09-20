import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ChipScroller } from './ui/ChipScroller';
import { AddWeekModal, type AddWeekMode } from './AddWeekModal';
import { SortableWeekChip } from './SortableWeekChip';
import { DayRow } from './ImportDayRow';
import {
  type Week,
  blockIndex,
  cloneWeekDays,
  emptyWeekDay,
  groupWeeks,
  renumberDraft,
  weekCaption
} from '../lib/importDraftWeeks';

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

export const DraftOutline = forwardRef<DraftOutlineHandle, {
  draft: ImportDraft;
  expandedDay: string | null;
  setExpandedDay: (id: string | null) => void;
  exercises: Exercise[];
  onDayChange: (day: DraftWorkout) => Promise<void>;
  onDraftChange: (draft: ImportDraft) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  canRestoreDraft?: boolean;
  acceptable?: boolean;
  busy?: boolean;
  onRestoreDraft?: () => void;
  onDiscardDraft?: () => void;
  onAcceptProgram?: () => void;
}>(function DraftOutline({
  draft,
  expandedDay,
  setExpandedDay,
  exercises,
  onDayChange,
  onDraftChange,
  onMapExerciseSlot,
  restorableExerciseLineIds,
  onRestoreExercise,
  canRestoreDraft,
  acceptable,
  busy,
  onRestoreDraft,
  onDiscardDraft,
  onAcceptProgram
}, ref) {
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
    setExpandedDay(day.isRestDay ? null : day.lineId);

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
      let b = list.find(item => item.name.trim().toLowerCase() === w.block.trim().toLowerCase());
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

    const targetBlockWeeks = weeks.filter(w => w.block.trim().toLowerCase() === week.block.trim().toLowerCase());
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
    const target = exerciseLineId
      ? draft.workouts.flatMap(workout => workout.exercises.map(exercise => ({ workout, exercise }))).find(item => item.exercise.lineId === exerciseLineId)
      : undefined;
    const targetSlot = target?.exercise.slotKey;
    const targetBlock = (target?.workout.block || week.block || 'Program').trim().toLowerCase();
    const updatedWorkouts = draft.workouts.map(workout => {
      const inSameBlock = (workout.block || 'Program').trim().toLowerCase() === targetBlock;
      if (!inSameBlock) return workout;

      const updatedExercises = workout.exercises.map(ex => {
        const matches = targetSlot
          ? ex.slotKey === targetSlot
          : (exerciseLineId && ex.lineId === exerciseLineId)
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
          <span className="import-program-kicker">Program timeline · {weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</span>
          <h2>{draft.programName}</h2>
        </div>
      </div>
      <div className="import-program-actions">
        {canRestoreDraft && onRestoreDraft && (
          <Button variant="tertiary" disabled={busy && !canRestoreDraft} onClick={onRestoreDraft}>
            <RotateCcw size={15} />Restore default draft
          </Button>
        )}
        {onDiscardDraft && (
          <Button variant="destructive" disabled={busy} onClick={onDiscardDraft}>
            <Trash2 size={15} />Discard draft
          </Button>
        )}
        {onAcceptProgram && (
          <Button
            variant="primary"
            disabled={busy || !acceptable}
            title={!acceptable ? 'Resolve review items before creating the program' : undefined}
            onClick={onAcceptProgram}
          >
            <Check size={15} />Accept and create program
          </Button>
        )}
      </div>
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
          variant="tertiary"
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
        onMapExerciseSlot={onMapExerciseSlot}
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
