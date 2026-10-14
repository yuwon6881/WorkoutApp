import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { ChipScroller } from './ui/ChipScroller';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { SortableWeekChip } from './SortableWeekChip';
import { isBlockEmpty } from '../lib/importDraftWeeks';
import type { ProgramStructureEditor } from './useProgramStructureEditor';

function blockLabel(index: number): string {
  return `Block ${index + 1}`;
}

/// Block and week navigation. Every structural action for a block or a week lives on the chip it
/// belongs to, so the bar carries the plan itself rather than a row of buttons beside it.
export function ProgramStructureBar({ structure, readOnly = false }: { structure: ProgramStructureEditor; readOnly?: boolean }) {
  const {
    weeks, blocks, week, setSelectedWeek, selectedBlockIndex,
    totalDayCount, setWeekModalOpen, setDeleteConfirmWeek, setDeleteConfirmBlock, deleteBlock,
    setRenameBlock, setRenameValue, draggedWeek, setDraggedWeek, dropTarget, setDropTarget,
    reorderWeeks, reorderBlocks, addBlock, weekHasHistory, blockHasHistory, canAddWeekAfter
  } = structure;

  if (!week) return null;
  const atCapacity = weeks.length >= 104 || totalDayCount >= 400;
  // A new week lands after the selected block's last week, which must not be before the week in progress.
  const selectedBlockLast = blocks[selectedBlockIndex]?.weeks.at(-1);
  const weekAddBlocked = atCapacity || !canAddWeekAfter(selectedBlockLast);

  return <div className="ptl-structure-bar">
    <div className="ptl-structure-row ptl-block-row">
      <span className="ptl-structure-caption" id="ptl-blocks-caption">Block</span>
      <div className="program-block-control-bar ptl-block-control-bar">
        <div className="import-block-selector ptl-block-selector" role="tablist" aria-labelledby="ptl-blocks-caption">
          {blocks.map((block, index) => {
            const isSelected = block.id === week.blockId;
            const label = blockLabel(index);
            const sealed = blockHasHistory(block);
            const previousSealed = index > 0 && blockHasHistory(blocks[index - 1]);
            return <span key={block.id} role="presentation"
              className={`chip-group import-block-chip-group ${isSelected ? 'active' : 'chip-group-lone'} ptl-chip-group ptl-block-chip-group ${isSelected ? 'ptl-chip-active' : ''}`}>
              <Button presentation="plain" role="tab" aria-selected={isSelected}
                className={`filter-chip ${isSelected ? 'active' : ''} ptl-chip ${isSelected ? 'ptl-chip-active' : ''}`}
                onClick={() => setSelectedWeek(block.weeks[0]?.week ?? week.week)}>
                {label}
              </Button>
              {isSelected && !readOnly && <MenuButton label={`Actions for ${label}`} triggerClassName="chip-icon-btn ptl-chip-action-btn ptl-chip-menu-btn" align="start" portal>
                <MenuItem disabled={sealed} onClick={() => { setRenameValue(block.name); setRenameBlock({ id: block.id, name: block.name }); }}>
                  <Pencil size={14} />Rename block
                </MenuItem>
                <MenuItem disabled={selectedBlockIndex <= 0 || sealed || previousSealed}
                  onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex - 1)}>
                  <ArrowUp size={14} />Move block earlier
                </MenuItem>
                <MenuItem disabled={selectedBlockIndex < 0 || selectedBlockIndex >= blocks.length - 1 || sealed}
                  onClick={() => reorderBlocks(selectedBlockIndex, selectedBlockIndex + 1)}>
                  <ArrowDown size={14} />Move block later
                </MenuItem>
                <MenuItem destructive disabled={blocks.length <= 1 || sealed} onClick={() => {
                  if (isBlockEmpty(block)) {
                    deleteBlock(block.id);
                  } else {
                    setDeleteConfirmBlock(block.id);
                  }
                }}>
                  <Trash2 size={14} />Delete block
                </MenuItem>
              </MenuButton>}
            </span>;
          })}
          {!readOnly && <Button presentation="plain" className="chip-add-btn ptl-add-btn" aria-label="Add block"
            disabled={atCapacity} onClick={addBlock}>
            <Plus size={15} />
            <span className="ptl-add-btn-label">Add block</span>
          </Button>}
        </div>
      </div>
    </div>

    <div className="ptl-structure-row ptl-week-row">
      <span className="ptl-structure-caption" id="ptl-weeks-caption">Week</span>
      <div className="ptl-week-scroller-wrap">
        <ChipScroller ariaLabel="Program weeks" role="tablist" resetKey={weeks.map(entry => entry.week).join('|')}
          leftLabel="Scroll program weeks left" rightLabel="Scroll program weeks right">
          {readOnly && weeks.map(entry => <span key={entry.week} role="presentation" data-import-week-chip={entry.week}
            className={`chip-group import-week-chip-group chip-group-lone ${entry.week === week.week ? 'active' : ''} ptl-chip-group ptl-week-chip-group ${entry.week === week.week ? 'ptl-chip-active' : ''}`.trim()}>
            <Button presentation="plain" role="tab" aria-selected={entry.week === week.week}
              className={`filter-chip import-week-chip ${entry.week === week.week ? 'active' : ''} ptl-chip ${entry.week === week.week ? 'ptl-chip-active' : ''}`.trim()}
              onClick={() => setSelectedWeek(entry.week)}>
              Week {entry.week}
            </Button>
          </span>)}
          {!readOnly && weeks.map(entry => <SortableWeekChip key={entry.week} week={entry.week} selected={entry.week === week.week}
            dragging={draggedWeek === entry.week}
            dropSide={dropTarget?.week === entry.week && draggedWeek !== entry.week ? dropTarget.side : null}
            onSelect={() => setSelectedWeek(entry.week)}
            locked={weekHasHistory(entry)}
            onDelete={entry.week === week.week && weeks.length > 1 && !weekHasHistory(entry)
              ? () => setDeleteConfirmWeek(entry.week)
              : undefined}
            onDragStart={() => { setDraggedWeek(entry.week); setDropTarget(null); }}
            onDragOver={(weekNumber, side) => setDropTarget({ week: weekNumber, side })}
            onDrop={(weekNumber, side) => reorderWeeks(draggedWeek ?? entry.week, weekNumber ?? dropTarget?.week ?? entry.week, side ?? dropTarget?.side ?? 'before')} />)}
          {!readOnly && <Button presentation="plain" className="chip-add-btn ptl-add-btn" aria-label="Add week"
            disabled={weekAddBlocked} onClick={() => setWeekModalOpen(true)}>
            <Plus size={15} />
            <span className="ptl-add-btn-label">Add week</span>
          </Button>}
        </ChipScroller>
      </div>
    </div>
  </div>;
}
