import { useCallback, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { activeSlotApi } from '../lib/api/activeSlot';
import { hasSlotProgress, isSlotItemFinished, slotItemId, slotItemName, type SlotItem } from '../lib/activeSlot';
import type { SlotZone } from './useWorkoutSlotDrag';

export type SlotConfirmation = {
  title: string;
  body: string;
  action: string;
  /// The item shown as leaving its place while the question is open; Cancel puts it back.
  movingId: string | null;
  run: () => Promise<unknown>;
};

/// Every way a workout enters or leaves the active slot — drag, card menu, or the finished-card
/// buttons — goes through here, so the progress confirmation is asked the same way each time.
export function useWorkoutSlotActions({ holder, onChanged, onTemplateDeleted }: {
  holder: SlotItem | null;
  onChanged: () => Promise<void>;
  onTemplateDeleted?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<SlotConfirmation | null>(null);

  const perform = useCallback(async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await run();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not update your workouts. Try again.');
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const setActive = useCallback((item: SlotItem, active: boolean) => item.kind === 'program'
    ? api.setProgramActive(item.program.id, active, item.program.revision)
    : activeSlotApi.setTemplateActive(item.template.id, active, item.template.revision), []);

  const activate = useCallback((item: SlotItem) => {
    const run = () => setActive(item, true);
    if (holder && hasSlotProgress(holder)) {
      setConfirmation({
        title: `Replace ${slotItemName(holder)}?`,
        body: `${slotItemName(item)} becomes your active workout. The progress in ${slotItemName(holder)} will be forgotten, though finished sessions stay in your history.`,
        action: 'Replace and forget progress',
        movingId: null,
        run
      });
      return;
    }
    void perform(run);
  }, [holder, perform, setActive]);

  const moveToLibrary = useCallback((item: SlotItem) => {
    const run = () => setActive(item, false);
    if (hasSlotProgress(item)) {
      setConfirmation({
        title: `Move ${slotItemName(item)} to the library?`,
        body: 'Its progress will be forgotten. Activating it again starts from the beginning; finished sessions stay in your history.',
        action: 'Move and forget progress',
        movingId: slotItemId(item),
        run
      });
      return;
    }
    void perform(run);
  }, [perform, setActive]);

  const restart = useCallback((item: SlotItem) => {
    const run = () => item.kind === 'program'
      ? activeSlotApi.restartProgram(item.program.id, item.program.revision)
      : activeSlotApi.restartTemplate(item.template.id, item.template.revision);
    if (hasSlotProgress(item) && !isSlotItemFinished(item)) {
      setConfirmation({
        title: `Restart ${slotItemName(item)}?`,
        body: 'Your progress so far will be forgotten and the plan starts again from the beginning. Finished sessions stay in your history.',
        action: 'Restart',
        movingId: null,
        run
      });
      return;
    }
    void perform(run);
  }, [perform]);

  const remove = useCallback((item: SlotItem) => {
    setConfirmation({
      title: `Delete ${slotItemName(item)}?`,
      body: 'This removes the plan from your library. Finished sessions stay in your history.',
      action: 'Delete',
      movingId: null,
      run: async () => {
        if (item.kind === 'program') await api.deleteProgram(item.program.id);
        else {
          await api.deleteTemplate(item.template.id);
          onTemplateDeleted?.(item.template.id);
        }
      }
    });
  }, [onTemplateDeleted]);

  const drop = useCallback((item: SlotItem, _from: SlotZone, to: SlotZone) => {
    if (to === 'active') activate(item);
    else moveToLibrary(item);
  }, [activate, moveToLibrary]);

  const confirm = useCallback(() => {
    if (!confirmation) return;
    const { run } = confirmation;
    setConfirmation(null);
    void perform(run);
  }, [confirmation, perform]);

  return { busy, error, confirmation, cancel: () => setConfirmation(null), confirm, activate, moveToLibrary, restart, remove, drop };
}
