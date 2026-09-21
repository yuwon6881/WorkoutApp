import { forwardRef, useCallback, useImperativeHandle } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Check, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Field } from './ui/Field';
import { Select } from './ui/Select';
import { ChipScroller } from './ui/ChipScroller';
import { AddWeekModal } from './AddWeekModal';
import { SortableWeekChip } from './SortableWeekChip';
import { DayRow } from './ImportDayRow';
import { blockIndex, weekCaption } from '../lib/importDraftWeeks';
import { useProgramStructureEditor } from './useProgramStructureEditor';
import './ProgramBuilder.css';

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
  editorMode?: 'import' | 'custom';
  actionLabel?: string;
  editableProgramName?: boolean;
  onProgramNameChange?: (name: string) => void;
  actionHint?: string;
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
  editorMode = 'import',
  actionLabel = 'Accept and create program',
  editableProgramName,
  onProgramNameChange,
  actionHint,
  acceptable,
  busy,
  onRestoreDraft,
  onDiscardDraft,
  onAcceptProgram
}, ref) {
  const structure = useProgramStructureEditor({ draft, onDraftChange, onDayChange });
  const {
    normalizedDraft, weeks, blocks, week, setSelectedWeek, selectedBlock, selectedBlockIndex,
    selectedBlockWeeks, totalDayCount, canAddDay, weekModalOpen, setWeekModalOpen, deleteConfirmWeek,
    setDeleteConfirmWeek, deleteConfirmBlock, setDeleteConfirmBlock, deleteConfirmDay, setDeleteConfirmDay,
    restConfirmDay, setRestConfirmDay, renameBlock, setRenameBlock, renameValue, setRenameValue,
    draggedWeek, setDraggedWeek, dropTarget, setDropTarget, reorderWeeks, reorderBlocks, addBlock,
    commitBlockName, deleteBlock, addWeek, deleteWeek, addDay, duplicateDay, reorderDay, deleteDay,
    changeDayKind, confirmRestConversion, moveDayToWeek
  } = structure;

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

  const propagateSubstitution = useCallback(async (currentName: string, replacementName: string, exerciseLineId?: string) => {
    const replacementLibraryExercise = exercises.find(
      e => e.name.toLowerCase() === replacementName.toLowerCase() || e.aliases.some(a => a.toLowerCase() === replacementName.toLowerCase())
    );
    const target = exerciseLineId
      ? normalizedDraft.workouts.flatMap(workout => workout.exercises.map(exercise => ({ workout, exercise }))).find(item => item.exercise.lineId === exerciseLineId)
      : undefined;
    if (!target && !week) return;
    const targetSlot = target?.exercise.slotKey;
    const targetBlock = target?.workout.blockId ?? week?.blockId;
    if (!targetBlock) return;
    const updatedWorkouts = normalizedDraft.workouts.map(workout => {
      const inSameBlock = workout.blockId === targetBlock;
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

    await onDraftChange({ ...normalizedDraft, workouts: updatedWorkouts });
  }, [normalizedDraft, onDraftChange, week?.blockId, exercises]);

  if (!week) return null;

  return <>
    <section className="panel import-program-card" data-editor-mode={editorMode}>
    <div className="section-heading import-program-heading">
      <div className="import-program-title">
        <span className="import-program-icon" aria-hidden="true"><CalendarDays size={18} /></span>
        <div>
          <span className="import-program-kicker">Program timeline · {weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</span>
          {editableProgramName
            ? <Field label="Program name" name="program-name" value={draft.programName}
              onChange={event => onProgramNameChange?.(event.currentTarget.value)} />
            : <h2>{draft.programName}</h2>}
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
            title={!acceptable ? actionHint ?? 'Resolve review items before creating the program' : undefined}
            onClick={onAcceptProgram}
          >
            <Check size={15} />{actionLabel}
          </Button>
        )}
      </div>
    </div>
    <div className="import-block-selector" role="tablist" aria-label="Program blocks">
      {blocks.map((block, index) => {
        const isSelected = block.id === week.blockId;
        return <Button key={block.id} presentation="plain" role="tab" aria-selected={isSelected}
          className={`filter-chip ${isSelected ? 'active' : ''}`}
          onClick={() => setSelectedWeek(block.weeks[0]?.week ?? week.week)}>
          Block {index + 1}{block.name && block.name !== `Block ${index + 1}` && block.name !== 'Program' ? ` · ${block.name}` : ''}
        </Button>;
      })}
    </div>
    <div className="program-structure-actions">
      <Button variant="secondary" disabled={weeks.length >= 104 || totalDayCount >= 400} onClick={addBlock}><Plus size={15} />Add block</Button>
      <Button variant="tertiary" onClick={() => { setRenameValue(blocks[selectedBlockIndex]?.name ?? ''); setRenameBlock({ id: week.blockId, name: week.block }); }}>Rename block</Button>
      <Button variant="tertiary" aria-label="Move block earlier" disabled={selectedBlockIndex <= 0} onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex - 1)}><ArrowUp size={15} /></Button>
      <Button variant="tertiary" aria-label="Move block later" disabled={selectedBlockIndex < 0 || selectedBlockIndex >= blocks.length - 1} onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex + 1)}><ArrowDown size={15} /></Button>
      <Button variant="destructive" disabled={blocks.length <= 1} onClick={() => setDeleteConfirmBlock(week.blockId)}><Trash2 size={15} />Delete block</Button>
    </div>
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
      <Button presentation="plain" className="filter-chip import-add-week-chip" aria-label="Add week" disabled={weeks.length >= 104 || totalDayCount >= 400} onClick={() => setWeekModalOpen(true)}>
        <Plus size={15} />Add week
      </Button>
    </ChipScroller>
    <div className="import-week-toolbar">
      <p className="import-week-caption">{weekCaption(week, selectedBlock)}</p>
      {selectedBlockWeeks.length > 1 && (
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
    <div className="import-week-toolbar program-day-add-actions">
      <span className="muted">{week.days.length} of 7 days</span>
      <div className="settings-actions">
        <Button variant="secondary" disabled={!canAddDay} onClick={() => addDay(false)}><Plus size={15} />Add workout day</Button>
        <Button variant="tertiary" disabled={!canAddDay} onClick={() => addDay(true)}><Plus size={15} />Add rest day</Button>
      </div>
    </div>
    <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week}`}>
      {week.days.map((day, dayIndex) => <div key={day.lineId} className="program-day-entry">
        <div className="program-day-toolbar">
          <span className="tiny-label">Day {dayIndex + 1} of {week.days.length}</span>
          <details className="program-day-menu">
            <summary>Day actions</summary>
            <div className="program-day-menu-content">
              <Button variant="tertiary" disabled={dayIndex === 0} aria-label={`Move ${day.name} earlier`} onClick={() => reorderDay(day.lineId, -1)}><ArrowUp size={15} />Move earlier</Button>
              <Button variant="tertiary" disabled={dayIndex === week.days.length - 1} aria-label={`Move ${day.name} later`} onClick={() => reorderDay(day.lineId, 1)}><ArrowDown size={15} />Move later</Button>
              <Button variant="tertiary" disabled={!canAddDay} onClick={() => duplicateDay(day.lineId)}><Copy size={15} />Duplicate day</Button>
              <Button variant="tertiary" onClick={() => changeDayKind(day)}>{day.isRestDay ? 'Make training day' : 'Make rest day'}</Button>
              {weeks.length > 1 && (week.days.length <= 1
                ? <span className="muted small-copy">Add another day before moving this one.</span>
                : <Select ariaLabel={`Move ${day.name} to another week`} value={week.weekId}
                options={weeks.filter(target => target.weekId === week.weekId || target.days.length < 7)
                  .map(target => ({ value: target.weekId, label: `Block ${blockIndex(weeks, target.week - 1)} · Week ${target.week}` }))}
                onChange={value => moveDayToWeek(day.lineId, String(value))} />)}
              <Button variant="destructive" disabled={week.days.length <= 1} onClick={() => setDeleteConfirmDay(day.lineId)}><Trash2 size={15} />Delete day</Button>
            </div>
          </details>
        </div>
        <DayRow day={day} expanded={expandedDay === day.lineId}
          onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange}
          onPropagateSubstitution={propagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          restorableExerciseLineIds={restorableExerciseLineIds}
          onRestoreExercise={onRestoreExercise} />
      </div>)}
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
    {renameBlock && (
      <Modal title="Rename block" onClose={() => setRenameBlock(null)}>
        <div className="modal-body">
          <Field label="Block name" name="block-name" value={renameValue} autoFocus maxLength={80}
            onChange={event => setRenameValue(event.currentTarget.value)} />
          {blocks.some(block => block.id !== renameBlock.id && block.name.trim().toLocaleLowerCase() === renameValue.trim().toLocaleLowerCase())
            && <p className="error-text" role="alert">Each block needs a different name.</p>}
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setRenameBlock(null)}>Cancel</Button>
          <Button variant="primary" disabled={!renameValue.trim() || renameValue.trim().length > 80
            || blocks.some(block => block.id !== renameBlock.id && block.name.trim().toLocaleLowerCase() === renameValue.trim().toLocaleLowerCase())}
            onClick={commitBlockName}>Save block name</Button>
        </div>
      </Modal>
    )}
    {deleteConfirmBlock !== null && (() => {
      const block = blocks.find(entry => entry.id === deleteConfirmBlock);
      const exerciseCount = block?.weeks.flatMap(entry => entry.days).reduce((count, day) => count + day.exercises.length, 0) ?? 0;
      return <Modal title="Delete this block?" onClose={() => setDeleteConfirmBlock(null)}>
        <div className="modal-body">
          <p>Delete <strong>{block?.name ?? 'this block'}</strong>, including {block?.weeks.length ?? 0} {(block?.weeks.length ?? 0) === 1 ? 'week' : 'weeks'}, its days, and {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}?</p>
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setDeleteConfirmBlock(null)}>Keep block</Button>
          <Button variant="destructive" disabled={blocks.length <= 1} onClick={() => deleteBlock(deleteConfirmBlock)}><Trash2 size={15} />Delete block</Button>
        </div>
      </Modal>;
    })()}
    {deleteConfirmDay !== null && (() => {
      const day = week.days.find(entry => entry.lineId === deleteConfirmDay);
      return <Modal title="Delete this day?" onClose={() => setDeleteConfirmDay(null)}>
        <div className="modal-body">
          <p>Delete <strong>{day?.name ?? 'this day'}</strong> and its {day?.exercises.length ?? 0} {(day?.exercises.length ?? 0) === 1 ? 'exercise' : 'exercises'} from Week {week.week}?</p>
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setDeleteConfirmDay(null)}>Keep day</Button>
          <Button variant="destructive" disabled={week.days.length <= 1} onClick={() => deleteDay(deleteConfirmDay)}><Trash2 size={15} />Delete day</Button>
        </div>
      </Modal>;
    })()}
    {restConfirmDay !== null && (
      <Modal title="Make this a rest day?" onClose={() => setRestConfirmDay(null)}>
        <div className="modal-body"><p>This clears the workout name, notes, and exercise prescriptions for this day.</p></div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setRestConfirmDay(null)}>Keep workout</Button>
          <Button variant="destructive" onClick={confirmRestConversion}>Clear workout and make rest day</Button>
        </div>
      </Modal>
    )}
    {deleteConfirmWeek !== null && (
      <Modal title={`Delete Week ${deleteConfirmWeek}?`} onClose={() => setDeleteConfirmWeek(null)}>
        <div className="modal-body">
          <p>
            Are you sure you want to delete <strong>Week {deleteConfirmWeek}</strong>? All {weeks.find(entry => entry.week === deleteConfirmWeek)?.days.length ?? 0} days and their exercises will be removed; subsequent weeks will be renumbered.
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
