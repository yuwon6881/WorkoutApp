import { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import { CalendarDays, Check, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft } from '../types';
import { applyExerciseEdit, countOccurrences, type ExerciseEditing } from '../lib/exerciseEditScope';
import { hasFinePointer } from '../lib/inputModality';
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
  onExerciseChange?: (draft: ImportDraft) => Promise<void>;
  onCustomExerciseCreated?: () => Promise<void>;
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
  readOnly?: boolean;
}>(function DraftOutline({
  draft,
  expandedDay,
  setExpandedDay,
  exercises,
  onDayChange,
  onDraftChange,
  onExerciseChange,
  onCustomExerciseCreated,
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
  onAcceptProgram,
  readOnly = false
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

    const reveal = () => {
      let attempts = 0;
      const tryFocus = () => {
        const modalNode = document.querySelector<HTMLElement>(`[data-import-day="${day.lineId}"].day-detail-modal-body`);
        const rowNode = [...document.querySelectorAll<HTMLElement>('[data-import-day]')]
          .find(node => node.dataset.importDay === day.lineId);
        const dayNode = modalNode ?? rowNode;
        if (!dayNode) {
          if (++attempts < 30) window.setTimeout(tryFocus, 20);
          return;
        }
        const weekNode = [...document.querySelectorAll<HTMLElement>('[data-import-week-chip]')]
          .find(node => node.dataset.importWeekChip === String(displayWeek));
        const exerciseNode = target.exerciseLineId
          ? (document.querySelector<HTMLElement>(`[data-import-exercise="${target.exerciseLineId}"]`)
            ?? dayNode.querySelector<HTMLElement>(`[data-import-exercise="${target.exerciseLineId}"]`))
          : null;
        if (target.exerciseLineId && !exerciseNode) {
          if (++attempts < 30) window.setTimeout(tryFocus, 20);
          return;
        }
        const scope = exerciseNode ?? dayNode;
        const fields = [...scope.querySelectorAll<HTMLElement>('[data-import-field]')]
          .filter(node => !target.targetField || node.dataset.importField === target.targetField)
          .filter(node => target.setIndex == null || node.dataset.importSetIndex === String(target.setIndex));
        const field = fields[0];
        const control = field?.matches('input,button,textarea,[tabindex]')
          ? field
          : field?.querySelector<HTMLElement>('input,button,textarea,[tabindex]');
        if (target.targetField && !control) {
          if (++attempts < 30) window.setTimeout(tryFocus, 20);
          return;
        }
        const destination = target.targetField === 'week' ? weekNode ?? scope : control ?? field ?? scope;
        destination.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        // On a phone a focused text field raises the keyboard over the issue being shown; the
        // highlight already points at it, and a tap starts the edit.
        const focusable = control && (hasFinePointer() || !control.matches('input, textarea')) ? control : null;
        focusable?.focus();
        const highlight = target.targetField === 'week' ? weekNode ?? dayNode : field ?? exerciseNode ?? dayNode;
        highlight.classList.add('issue-focus');
        window.setTimeout(() => highlight.classList.remove('issue-focus'), 1800);
        if (focusable && attempts < 15) {
          attempts++;
          window.setTimeout(tryFocus, 25);
        }
      };
      window.setTimeout(tryFocus, 25);
    };
    reveal();
  }, [draft.workouts, setExpandedDay, setSelectedWeek, weeks]);

  useImperativeHandle(ref, () => ({ focusIssue }), [focusIssue]);

  // A saved exercise edit rewrites the whole draft, so the other occurrences it reaches change in
  // the same revision-checked write as the exercise itself.
  const editing = useMemo<Omit<ExerciseEditing, 'unsaved'>>(() => ({
    save: (base, edited, scope) => (onExerciseChange ?? onDraftChange)(applyExerciseEdit(normalizedDraft, base, edited, scope, exercises)),
    count: base => countOccurrences(normalizedDraft, base),
    keepWrittenName: editorMode === 'import'
  }), [editorMode, exercises, normalizedDraft, onDraftChange, onExerciseChange]);

  if (!week) return null;

  // The library shows a saved program inside its own card, so the view-only timeline carries no
  // heading, actions, or editing dialogs of its own.
  if (readOnly) {
    return <section className="import-program-card readonly-program-timeline" data-editor-mode="readonly">
      <ProgramStructureBar structure={structure} readOnly />
      <ProgramDayList structure={structure} exercises={exercises} openDay={expandedDay} setOpenDay={setExpandedDay}
        onDayChange={onDayChange} editing={editing} readOnly />
    </section>;
  }

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
        openDay={expandedDay}
        setOpenDay={setExpandedDay}
        onDayChange={onDayChange}
        editing={editing}
        onCustomExerciseCreated={onCustomExerciseCreated}
        restorableExerciseLineIds={restorableExerciseLineIds}
        onRestoreExercise={onRestoreExercise}
      />
    </section>
    <ProgramStructureModals structure={structure} />
  </>;
});
