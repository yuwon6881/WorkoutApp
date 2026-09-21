import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { ChipScroller } from './ui/ChipScroller';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { SortableWeekChip } from './SortableWeekChip';
import { weekCaption } from '../lib/importDraftWeeks';
import type { ProgramStructureEditor } from './useProgramStructureEditor';

function blockLabel(name: string, index: number): string {
  const fallback = `Block ${index + 1}`;
  return !name || name === fallback || name === 'Program' ? fallback : `${fallback} · ${name}`;
}

/// Block and week navigation. Every structural action for a block or a week lives on the chip it
/// belongs to, so the bar carries the plan itself rather than a row of buttons beside it.
export function ProgramStructureBar({ structure }: { structure: ProgramStructureEditor }) {
  const {
    weeks, blocks, week, setSelectedWeek, selectedBlock, selectedBlockIndex, selectedBlockWeeks,
    totalDayCount, canAddDay, setWeekModalOpen, setDeleteConfirmWeek, setDeleteConfirmBlock,
    setRenameBlock, setRenameValue, draggedWeek, setDraggedWeek, dropTarget, setDropTarget,
    reorderWeeks, reorderBlocks, addBlock, addDay
  } = structure;

  if (!week) return null;
  const atCapacity = weeks.length >= 104 || totalDayCount >= 400;

  return <>
    <div className="program-block-control-bar">
      <div className="import-block-selector" role="tablist" aria-label="Program blocks">
        {blocks.map((block, index) => {
          const isSelected = block.id === week.blockId;
          const label = blockLabel(block.name, index);
          return <span key={block.id} role="presentation"
            className={`chip-group import-block-chip-group ${isSelected ? 'active' : ''}`}>
            <Button presentation="plain" role="tab" aria-selected={isSelected}
              className={`filter-chip ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedWeek(block.weeks[0]?.week ?? week.week)}>
              {label}
            </Button>
            {isSelected && <MenuButton label={`Actions for ${label}`} triggerClassName="chip-icon-btn">
              <MenuItem onClick={() => { setRenameValue(block.name); setRenameBlock({ id: block.id, name: block.name }); }}>
                <Pencil size={14} />Rename block
              </MenuItem>
              <MenuItem disabled={selectedBlockIndex <= 0}
                onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex - 1)}>
                <ArrowUp size={14} />Move block earlier
              </MenuItem>
              <MenuItem disabled={selectedBlockIndex < 0 || selectedBlockIndex >= blocks.length - 1}
                onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex + 1)}>
                <ArrowDown size={14} />Move block later
              </MenuItem>
              <MenuItem destructive disabled={blocks.length <= 1} onClick={() => setDeleteConfirmBlock(block.id)}>
                <Trash2 size={14} />Delete block
              </MenuItem>
            </MenuButton>}
          </span>;
        })}
      </div>
      <Button presentation="plain" className="chip-add-btn" aria-label="Add block" title="Add block"
        disabled={atCapacity} onClick={addBlock}>
        <Plus size={16} />
      </Button>
    </div>

    <ChipScroller ariaLabel="Program weeks" role="tablist" resetKey={weeks.map(entry => entry.week).join('|')}
      leftLabel="Scroll program weeks left" rightLabel="Scroll program weeks right">
      {weeks.map(entry => <SortableWeekChip key={entry.week} week={entry.week} selected={entry.week === week.week}
        dragging={draggedWeek === entry.week}
        dropSide={dropTarget?.week === entry.week && draggedWeek !== entry.week ? dropTarget.side : null}
        onSelect={() => setSelectedWeek(entry.week)}
        onDelete={entry.week === week.week && selectedBlockWeeks.length > 1
          ? () => setDeleteConfirmWeek(entry.week)
          : undefined}
        onDragStart={() => { setDraggedWeek(entry.week); setDropTarget(null); }}
        onDragOver={(weekNumber, side) => setDropTarget({ week: weekNumber, side })}
        onDrop={(weekNumber, side) => reorderWeeks(draggedWeek ?? entry.week, weekNumber ?? dropTarget?.week ?? entry.week, side ?? dropTarget?.side ?? 'before')} />)}
      <Button presentation="plain" className="chip-add-btn" aria-label="Add week" title="Add week"
        disabled={atCapacity} onClick={() => setWeekModalOpen(true)}>
        <Plus size={16} />
      </Button>
    </ChipScroller>

    <div className="import-week-toolbar program-day-add-actions">
      <div className="import-week-meta">
        <p className="import-week-caption">{weekCaption(week, selectedBlock)}</p>
        <span className="muted">{week.days.length} of 7 days</span>
      </div>
      <div className="settings-actions">
        <Button variant="secondary" aria-label="Add workout day" disabled={!canAddDay} onClick={() => addDay(false)}>
          <Plus size={15} />Workout day
        </Button>
        <Button variant="tertiary" aria-label="Add rest day" disabled={!canAddDay} onClick={() => addDay(true)}>
          <Plus size={15} />Rest day
        </Button>
      </div>
    </div>
  </>;
}
