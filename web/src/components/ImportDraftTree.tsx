import { forwardRef, useCallback, useImperativeHandle } from 'react';
import { CalendarDays, Check, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { demoUrlForName } from '../lib/demoLinks';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { ProgramStructureBar } from './ProgramStructureBar';
import { ProgramStructureModals } from './ProgramStructureModals';
import { ProgramDayList } from './ProgramDayList';
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
  const { normalizedDraft, weeks, week, setSelectedWeek } = structure;

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
  }, [draft.workouts, setExpandedDay, setSelectedWeek, weeks]);

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
            substitutions: nextSubs,
            demoUrl: demoUrlForName(ex.demoLinks, replacementLibraryExercise?.name ?? replacementName)
          };
        }
        return ex;
      });

      return { ...workout, exercises: updatedExercises };
    });

    await onDraftChange({ ...normalizedDraft, workouts: updatedWorkouts });
  }, [normalizedDraft, onDraftChange, week, exercises]);

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
          {(onRestoreDraft || onDiscardDraft) && (
            <MenuButton label="Draft actions" triggerClassName="program-actions-trigger">
              {canRestoreDraft && onRestoreDraft && (
                <MenuItem disabled={busy && !canRestoreDraft} onClick={onRestoreDraft}>
                  <RotateCcw size={14} />Restore default draft
                </MenuItem>
              )}
              {onDiscardDraft && (
                <MenuItem destructive disabled={busy} onClick={onDiscardDraft}>
                  <Trash2 size={14} />Discard draft
                </MenuItem>
              )}
            </MenuButton>
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

      <ProgramStructureBar structure={structure} />
      <ProgramDayList
        structure={structure}
        exercises={exercises}
        expandedDay={expandedDay}
        setExpandedDay={setExpandedDay}
        onDayChange={onDayChange}
        onPropagateSubstitution={propagateSubstitution}
        onMapExerciseSlot={onMapExerciseSlot}
        restorableExerciseLineIds={restorableExerciseLineIds}
        onRestoreExercise={onRestoreExercise}
      />
    </section>
    <ProgramStructureModals structure={structure} />
  </>;
});
