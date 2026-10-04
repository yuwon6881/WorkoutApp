import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ExerciseEditing, UnsavedExercise } from '../lib/exerciseEditScope';
import { Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Modal } from './ui/Modal';
import { DayRow, DayDetailContent } from './ImportDayRow';
import { DayEditor } from './ImportDayEditor';
import { ReadOnlyDay } from './ReadOnlyDay';
import { useEdgeAutoScroll } from './useEdgeAutoScroll';
import { dayTitle, isGenericDayTitle } from '../lib/dayTitle';
import type { ProgramStructureEditor } from './useProgramStructureEditor';

type DragState = { lineId: string; overIndex: number; side: 'before' | 'after' };

export function ProgramDayList({
  structure,
  exercises,
  openDay,
  setOpenDay,
  onDayChange,
  editing,
  onCustomExerciseCreated,
  restorableExerciseLineIds,
  onRestoreExercise,
  readOnly = false
}: {
  structure: ProgramStructureEditor;
  exercises: Exercise[];
  openDay: string | null;
  setOpenDay: (id: string | null) => void;
  onDayChange: (day: DraftWorkout) => Promise<void>;
  editing: Omit<ExerciseEditing, 'unsaved'>;
  onCustomExerciseCreated?: () => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const {
    week, canAddDay, duplicateDay, reorderDay, moveDayTo, setDeleteConfirmDay, addDay
  } = structure;
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointer = useRef<{ id: number; startY: number; lineId: string; index: number; active: boolean } | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const repRangeMemories = useRef(new Map<string, Map<number, number>>());
  // Edits no one has saved yet. They outlive the day dialog so closing it asks before discarding.
  const unsaved = useRef(new Map<string, UnsavedExercise>());
  const [discardPrompt, setDiscardPrompt] = useState<string | null>(null);

  const getRepRangeMemory = useCallback((exerciseLineId: string) => {
    let memory = repRangeMemories.current.get(exerciseLineId);
    if (!memory) {
      memory = new Map<number, number>();
      repRangeMemories.current.set(exerciseLineId, memory);
    }
    return memory;
  }, []);

  const days = week?.days ?? [];
  const openDayData = openDay ? days.find(d => d.lineId === openDay) : null;

  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  // A long week does not fit one screen, so holding a dragged day near an edge scrolls the page.
  const { update: updateEdgeScroll, stop: stopEdgeScroll } = useEdgeAutoScroll();

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.active) {
      if (Math.abs(event.clientY - current.startY) < 6) return;
      current.active = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable for synthetic pointers; the drag still tracks movement.
      }
      setDrag({ lineId: current.lineId, overIndex: current.index, side: 'before' });
    }
    event.preventDefault();
    updateEdgeScroll(event.clientY);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-day-index]');
    const raw = target?.dataset.dayIndex;
    if (!target || raw == null) return;
    const index = Number(raw);
    if (Number.isNaN(index)) return;
    const rect = target.getBoundingClientRect();
    const side: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const state = dragRef.current;
    if (!state || (state.overIndex === index && state.side === side)) return;
    setDrag({ ...state, overIndex: index, side });
  }, [setDrag, updateEdgeScroll]);

  const endPointer = useCallback((event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const current = pointer.current;
    const state = dragRef.current;
    pointer.current = null;
    stopEdgeScroll();
    if (!current || current.id !== event.pointerId) return;
    setDrag(null);
    if (!commit || !current.active || !state) return;
    const from = days.findIndex(day => day.lineId === state.lineId);
    if (from < 0) return;
    let insertAt = state.side === 'before' ? state.overIndex : state.overIndex + 1;
    if (from < insertAt) insertAt -= 1;
    moveDayTo(state.lineId, insertAt);
  }, [days, moveDayTo, setDrag]);

  const lastScrollTop = useRef<number>(0);

  const closeModal = useCallback(() => {
    if (unsaved.current.size > 0 && openDay) {
      const modalBody = document.querySelector('.day-detail-modal-body');
      if (modalBody) {
        lastScrollTop.current = modalBody.scrollTop;
      }
      setDiscardPrompt(openDay);
      return;
    }
    setOpenDay(null);
    setSelectedMuscle(null);
  }, [openDay, setOpenDay]);

  // The day dialog never closed, so keeping on editing returns to exactly where the lifter was.
  const handleKeepEditing = useCallback(() => {
    setDiscardPrompt(null);
    requestAnimationFrame(() => {
      const modalBody = document.querySelector('.day-detail-modal-body');
      if (modalBody) modalBody.scrollTop = lastScrollTop.current;
    });
  }, []);

  const handleDiscardChanges = useCallback(() => {
    unsaved.current.clear();
    setDiscardPrompt(null);
    setOpenDay(null);
    setSelectedMuscle(null);
  }, [setOpenDay]);

  if (!week) return null;

  const openDayIndex = openDayData ? days.indexOf(openDayData) : -1;
  const openDayTitle = openDayData ? dayTitle(openDayData.name, openDayIndex + 1) : '';
  const modalTitle = openDayData
    ? `Day ${openDayIndex + 1}${isGenericDayTitle(openDayTitle) ? '' : ` · ${openDayTitle}`}`
    : '';

  return <>
    <div className="import-week-days" role="tabpanel" aria-label={`Week ${week.week}`}>
      {days.map((day, dayIndex) => {
        const dropSide = drag && drag.lineId !== day.lineId && drag.overIndex === dayIndex ? drag.side : null;
        return <div
          key={day.lineId}
          className="program-day-entry"
          data-day-index={dayIndex}
          data-dragging={drag?.lineId === day.lineId ? 'true' : undefined}
          data-drop={dropSide ?? undefined}
        >
          <DayRow
            day={day}
            index={dayIndex}
            onOpen={() => setOpenDay(day.lineId)}
            exercises={exercises}
            handle={readOnly ? undefined : <Button
              presentation="plain"
              className="program-day-handle"
              aria-label={`Reorder ${day.name}, day ${dayIndex + 1} of ${days.length}. Press the up or down arrow key to move it.`}
              disabled={days.length <= 1}
              onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                reorderDay(day.lineId, event.key === 'ArrowUp' ? -1 : 1);
              }}
              onPointerDown={event => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (days.length <= 1) return;
                pointer.current = { id: event.pointerId, startY: event.clientY, lineId: day.lineId, index: dayIndex, active: false };
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={event => endPointer(event, true)}
              onPointerCancel={event => endPointer(event, false)}
            >
              <GripVertical size={16} />
            </Button>}
            menu={readOnly ? undefined : <MenuButton label={`Actions for ${day.name}`} triggerClassName="program-day-menu-trigger" portal>
              <MenuItem disabled={!canAddDay} onClick={() => duplicateDay(day.lineId)}>
                <Copy size={14} />Duplicate day
              </MenuItem>
              <MenuItem destructive disabled={days.length <= 1} onClick={() => setDeleteConfirmDay(day.lineId)}>
                <Trash2 size={14} />Delete day
              </MenuItem>
            </MenuButton>}
          />
        </div>;
      })}
    </div>
    {!readOnly && <div className="program-day-add-actions">
      <div className="program-day-add-buttons">
        <Button variant="secondary" aria-label="Add workout day" disabled={!canAddDay} onClick={() => addDay(false)}>
          <Plus size={15} />Workout day
        </Button>
        <Button variant="secondary" aria-label="Add rest day" disabled={!canAddDay} onClick={() => addDay(true)}>
          <Plus size={15} />Rest day
        </Button>
      </div>
    </div>}

    {discardPrompt && (
      <Modal title="Discard unsaved changes?" onClose={handleKeepEditing}>
        <div className="modal-body">
          <p>{unsaved.current.size === 1 ? 'An exercise on this day has' : `${unsaved.current.size} exercises have`} changes that were not saved.</p>
        </div>
        <div className="modal-actions">
          <Button variant="destructive" onClick={handleDiscardChanges}>Discard changes</Button>
          <Button variant="primary" onClick={handleKeepEditing}>Keep editing</Button>
        </div>
      </Modal>
    )}

    {openDayData && !openDayData.isRestDay && (
      <Modal title={modalTitle} wide onClose={closeModal} className="day-detail-modal">
        <div className="modal-body day-detail-modal-body draft-day" data-import-day={openDayData.lineId}>
          {readOnly
            ? <ReadOnlyDay day={openDayData} exercises={exercises} selectedMuscle={selectedMuscle} onMuscleSelect={setSelectedMuscle} />
            : <DayDetailContent
            day={openDayData}
            exercises={exercises}
            onChange={onDayChange}
            editing={{ ...editing, unsaved: unsaved.current }}
            onCustomExerciseCreated={onCustomExerciseCreated}
            restorableExerciseLineIds={restorableExerciseLineIds}
            onRestoreExercise={onRestoreExercise}
            DayEditorComponent={DayEditor}
            getRepRangeMemory={getRepRangeMemory}
            selectedMuscle={selectedMuscle}
            onMuscleSelect={setSelectedMuscle}
          />}
        </div>
        <div className="modal-actions">
          <Button variant="primary" onClick={closeModal}>Done</Button>
        </div>
      </Modal>
    )}
  </>;
}
