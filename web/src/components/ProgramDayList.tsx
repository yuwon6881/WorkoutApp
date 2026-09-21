import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Copy, Dumbbell, GripVertical, Moon, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { MenuButton, MenuItem, MenuNote } from './ui/MenuButton';
import { DayRow } from './ImportDayRow';
import { blockIndex } from '../lib/importDraftWeeks';
import type { ProgramStructureEditor } from './useProgramStructureEditor';

type DragState = { lineId: string; overIndex: number; side: 'before' | 'after' };

export function ProgramDayList({
  structure,
  exercises,
  expandedDay,
  setExpandedDay,
  onDayChange,
  onPropagateSubstitution,
  onMapExerciseSlot,
  restorableExerciseLineIds,
  onRestoreExercise
}: {
  structure: ProgramStructureEditor;
  exercises: Exercise[];
  expandedDay: string | null;
  setExpandedDay: (id: string | null) => void;
  onDayChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}) {
  const {
    weeks, week, canAddDay, duplicateDay, reorderDay, moveDayTo, setDeleteConfirmDay,
    changeDayKind, moveDayToWeek
  } = structure;
  const [drag, setDragState] = useState<DragState | null>(null);
  const [moveDayId, setMoveDayId] = useState<string | null>(null);
  const [moveTargetWeekId, setMoveTargetWeekId] = useState('');
  const dragRef = useRef<DragState | null>(null);
  const pointer = useRef<{ id: number; startY: number; lineId: string; index: number; active: boolean } | null>(null);

  const days = week?.days ?? [];

  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

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
  }, [setDrag]);

  const endPointer = useCallback((event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const current = pointer.current;
    const state = dragRef.current;
    pointer.current = null;
    if (!current || current.id !== event.pointerId) return;
    setDrag(null);
    if (!commit || !current.active || !state) return;
    const from = days.findIndex(day => day.lineId === state.lineId);
    if (from < 0) return;
    let insertAt = state.side === 'before' ? state.overIndex : state.overIndex + 1;
    if (from < insertAt) insertAt -= 1;
    moveDayTo(state.lineId, insertAt);
  }, [days, moveDayTo, setDrag]);

  if (!week) return null;

  const moveDay = moveDayId ? days.find(day => day.lineId === moveDayId) : undefined;
  const moveTargets = weeks.filter(target => target.weekId !== week.weekId && target.days.length < 7);

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
            expanded={expandedDay === day.lineId}
            onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)}
            exercises={exercises}
            onChange={onDayChange}
            onPropagateSubstitution={onPropagateSubstitution}
            onMapExerciseSlot={onMapExerciseSlot}
            restorableExerciseLineIds={restorableExerciseLineIds}
            onRestoreExercise={onRestoreExercise}
            handle={<Button
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
            menu={<MenuButton label={`Actions for ${day.name}`} triggerClassName="program-day-menu-trigger">
              <MenuItem disabled={!canAddDay} onClick={() => duplicateDay(day.lineId)}>
                <Copy size={14} />Duplicate day
              </MenuItem>
              <MenuItem onClick={() => changeDayKind(day)}>
                {day.isRestDay ? <Dumbbell size={14} /> : <Moon size={14} />}
                {day.isRestDay ? 'Make training day' : 'Make rest day'}
              </MenuItem>
              {weeks.length > 1 && (days.length <= 1
                ? <MenuNote>Add another day before moving this one.</MenuNote>
                : <MenuItem disabled={moveTargets.length === 0} onClick={() => {
                  setMoveTargetWeekId(moveTargets[0]?.weekId ?? '');
                  setMoveDayId(day.lineId);
                }}>
                  <CalendarDays size={14} />Move to another week…
                </MenuItem>)}
              <MenuItem destructive disabled={days.length <= 1} onClick={() => setDeleteConfirmDay(day.lineId)}>
                <Trash2 size={14} />Delete day
              </MenuItem>
            </MenuButton>}
          />
        </div>;
      })}
    </div>
    {moveDay && <Modal title="Move this day" onClose={() => setMoveDayId(null)}>
      <div className="modal-body">
        <p>Move <strong>{moveDay.name}</strong> out of Week {week.week} into another week of the plan.</p>
        <Select label="Destination week" name="move-day-week" value={moveTargetWeekId}
          options={moveTargets.map(target => ({
            value: target.weekId,
            label: `Block ${blockIndex(weeks, target.week - 1)} · Week ${target.week} · ${target.days.length} of 7 days`
          }))}
          onChange={value => setMoveTargetWeekId(String(value))} />
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={() => setMoveDayId(null)}>Cancel</Button>
        <Button variant="primary" disabled={!moveTargetWeekId} onClick={() => {
          moveDayToWeek(moveDay.lineId, moveTargetWeekId);
          setMoveDayId(null);
        }}>Move day</Button>
      </div>
    </Modal>}
  </>;
}
