import { Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { AddWeekModal } from './AddWeekModal';
import { isExerciseEmpty } from '../lib/importDraftWeeks';
import type { ProgramStructureEditor } from './useProgramStructureEditor';

/// Every confirmation the structure editor can raise. They are grouped so the outline itself stays
/// a layout, and each one names exactly what it removes before it removes it.
export function ProgramStructureModals({ structure }: { structure: ProgramStructureEditor }) {
  const {
    weeks, blocks, week, weekModalOpen, setWeekModalOpen, addWeek, selectedBlock,
    renameBlock, setRenameBlock, renameValue, setRenameValue, commitBlockName,
    deleteConfirmBlock, setDeleteConfirmBlock, deleteBlock,
    deleteConfirmDay, setDeleteConfirmDay, deleteDay,
    restConfirmDay, setRestConfirmDay, confirmRestConversion,
    deleteConfirmWeek, setDeleteConfirmWeek, deleteWeek
  } = structure;

  if (!week) return null;
  const duplicateName = (name: string, id: string) => blocks.some(block =>
    block.id !== id && block.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());

  return <>
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
          {duplicateName(renameValue, renameBlock.id)
            && <p className="error-text" role="alert">Each block needs a different name.</p>}
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setRenameBlock(null)}>Cancel</Button>
          <Button variant="primary"
            disabled={!renameValue.trim() || renameValue.trim().length > 80 || duplicateName(renameValue, renameBlock.id)}
            onClick={commitBlockName}>Save block name</Button>
        </div>
      </Modal>
    )}
    {deleteConfirmBlock !== null && (() => {
      const block = blocks.find(entry => entry.id === deleteConfirmBlock);
      const exercises = block?.weeks.flatMap(entry => entry.days).flatMap(day => day.exercises) ?? [];
      const realExercises = exercises.filter(e => !isExerciseEmpty(e));
      const exerciseCount = realExercises.length;
      return <Modal title="Delete this block?" onClose={() => setDeleteConfirmBlock(null)}>
        <div className="modal-body">
          <p>Delete <strong>{block?.name ?? 'this block'}</strong>, including {block?.weeks.length ?? 0} {(block?.weeks.length ?? 0) === 1 ? 'week' : 'weeks'}{exerciseCount > 0 ? `, its days, and ${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}` : ' and its days'}?</p>
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
        </div>
        <div className="modal-actions">
          <Button variant="tertiary" onClick={() => setDeleteConfirmWeek(null)}>Cancel</Button>
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
      </Modal>
    )}
  </>;
}
