import { useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/Button';

export interface SortableWeekChipProps {
  week: number;
  selected: boolean;
  dragging: boolean;
  dropSide: 'before' | 'after' | null;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (week: number, side: 'before' | 'after') => void;
  onDrop: (week?: number, side?: 'before' | 'after') => void;
  onDelete?: () => void;
}

export function SortableWeekChip({
  week,
  selected,
  dragging,
  dropSide,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDelete
}: SortableWeekChipProps) {
  const pointer = useRef<{ id: number; startX: number; startY: number; armed: boolean; moved: boolean; timer?: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);

  const clearPointer = () => {
    const current = pointer.current;
    if (current?.timer != null) window.clearTimeout(current.timer);
    pointer.current = null;
  };

  const calcSide = (clientX: number, target: HTMLElement): 'before' | 'after' => {
    const rect = target.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };

  const dropClass = dropSide === 'before' ? 'drop-indicator-before' : dropSide === 'after' ? 'drop-indicator-after' : '';

  return (
    <span
      role="presentation"
      data-import-week-chip={week}
      className={`chip-group import-week-chip-group ${selected ? 'active' : ''} ${!onDelete ? 'chip-group-lone' : ''} ${dragging ? 'dragging' : ''} ${dropClass}`.trim()}
    >
      <Button
        ref={chipRef}
        presentation="plain"
        role="tab"
        aria-selected={selected}
        draggable
        className={`filter-chip import-week-chip ${selected ? 'active' : ''}`}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onSelect();
        }}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragOver={event => {
          event.preventDefault();
          const side = calcSide(event.clientX, event.currentTarget);
          onDragOver(week, side);
        }}
        onDrop={event => {
          event.preventDefault();
          const side = calcSide(event.clientX, event.currentTarget);
          onDrop(week, side);
        }}
        onDragEnd={() => {
          clearPointer();
          suppressClick.current = false;
          onDrop();
        }}
        onPointerDown={event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          const current = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            armed: false,
            moved: false,
            timer: undefined as number | undefined
          };
          current.timer = window.setTimeout(() => {
            if (pointer.current?.id !== current.id || current.moved) return;
            current.armed = true;
            onDragStart();
            try {
              chipRef.current?.setPointerCapture(event.pointerId);
            } catch {
              /* synthetic pointer */
            }
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
          if (target?.dataset.importWeekChip) {
            const side = calcSide(event.clientX, target);
            onDragOver(Number(target.dataset.importWeekChip), side);
          }
        }}
        onPointerUp={event => {
          const current = pointer.current;
          if (!current || current.id !== event.pointerId) return;
          if (current.armed) {
            suppressClick.current = true;
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-import-week-chip]');
            if (target?.dataset.importWeekChip) {
              const side = calcSide(event.clientX, target);
              onDrop(Number(target.dataset.importWeekChip), side);
            } else {
              onDrop();
            }
          }
          clearPointer();
        }}
        onPointerCancel={clearPointer}
      >
        Week {week}
      </Button>
      {onDelete && (
        <Button
          presentation="plain"
          className="chip-icon-btn"
          aria-label={`Delete week ${week}`}
          title={`Delete week ${week}`}
          onClick={onDelete}
        >
          <X size={13} />
        </Button>
      )}
    </span>
  );
}
