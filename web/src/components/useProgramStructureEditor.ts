import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftWorkout, ImportDraft } from '../types';
import {
  blankExercise,
  cloneExercise,
  cloneWeekDays,
  emptyRestDay,
  emptyWeekDay,
  ensureStructureIds,
  groupWeeks,
  orderedBlocks,
  renumberDraft,
  blockIndex,
  type Week
} from '../lib/importDraftWeeks';
import type { AddWeekMode } from './AddWeekModal';

type Options = {
  draft: ImportDraft;
  onDraftChange: (draft: ImportDraft) => Promise<void>;
  onDayChange: (day: DraftWorkout) => Promise<void>;
};

export function useProgramStructureEditor({ draft, onDraftChange, onDayChange }: Options) {
  const normalizedDraft = useMemo(() => ensureStructureIds(draft), [draft]);
  const weeks = useMemo(() => groupWeeks(normalizedDraft), [normalizedDraft]);
  const blocks = useMemo(() => orderedBlocks(weeks), [weeks]);
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]?.week ?? 1);
  const [weekModalOpen, setWeekModalOpen] = useState(false);
  const [deleteConfirmWeek, setDeleteConfirmWeek] = useState<number | null>(null);
  const [deleteConfirmBlock, setDeleteConfirmBlock] = useState<string | null>(null);
  const [deleteConfirmDay, setDeleteConfirmDay] = useState<string | null>(null);
  const [restConfirmDay, setRestConfirmDay] = useState<string | null>(null);
  const [renameBlock, setRenameBlock] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggedWeek, setDraggedWeek] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ week: number; side: 'before' | 'after' } | null>(null);
  const pendingFocusWeek = useRef<number | null>(null);

  useEffect(() => {
    if (draft.workouts.some(day => !day.blockId || !day.weekId)) void onDraftChange(normalizedDraft);
  }, [draft.workouts, normalizedDraft, onDraftChange]);

  useEffect(() => {
    setSelectedWeek(current => {
      if (weeks.some(week => week.week === current)) return current;
      const first = weeks[0];
      if (!first) return 1;
      return weeks.reduce((nearest, candidate) =>
        Math.abs(candidate.week - current) < Math.abs(nearest.week - current) ? candidate : nearest,
        first).week;
    });
  }, [weeks]);

  useEffect(() => {
    if (pendingFocusWeek.current === null) return;
    const target = pendingFocusWeek.current;
    if (!weeks.some(week => week.week === target)) return;
    pendingFocusWeek.current = null;
    window.requestAnimationFrame(() => {
      const chip = document.querySelector<HTMLButtonElement>(`[data-import-week-chip="${target}"]`);
      chip?.focus();
      chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }, [weeks]);

  const week = weeks.find(entry => entry.week === selectedWeek) ?? weeks[0];
  const selectedIndex = week ? weeks.findIndex(entry => entry.week === week.week) : -1;
  const selectedBlock = blockIndex(weeks, selectedIndex);
  const selectedBlockIndex = week ? blocks.findIndex(block => block.id === week.blockId) : -1;
  const selectedBlockWeeks = blocks[selectedBlockIndex]?.weeks ?? [];
  const totalDayCount = normalizedDraft.workouts.length;
  const canAddDay = !!week && totalDayCount < 400 && week.days.length < 7;

  const reorderWeeks = useCallback((from: number, to: number, side: 'before' | 'after' = 'before') => {
    if (from === to && side === 'before') {
      setDraggedWeek(null);
      setDropTarget(null);
      return;
    }
    const fromIndex = weeks.findIndex(entry => entry.week === from);
    const toIndex = weeks.findIndex(entry => entry.week === to);
    if (fromIndex < 0 || toIndex < 0 || weeks[fromIndex].blockId !== weeks[toIndex].blockId) {
      setDraggedWeek(null);
      setDropTarget(null);
      return;
    }
    const insertionIndex = side === 'before' ? toIndex : toIndex + 1;
    const ordered = [...weeks];
    const [moved] = ordered.splice(fromIndex, 1);
    let targetIndex = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
    if (fromIndex < toIndex && side === 'before' && toIndex === fromIndex + 1) targetIndex = toIndex;
    ordered.splice(targetIndex, 0, moved);
    setSelectedWeek(targetIndex + 1);
    setDraggedWeek(null);
    setDropTarget(null);
    void onDraftChange(renumberDraft(normalizedDraft, ordered));
  }, [normalizedDraft, onDraftChange, weeks]);

  const reorderBlocks = useCallback((from: number, to: number) => {
    if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length || from === to) return;
    const reordered = [...blocks];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const orderedWeeks = reordered.flatMap(block => block.weeks);
    setSelectedWeek(orderedWeeks.findIndex(entry => entry.weekId === week?.weekId) + 1);
    void onDraftChange(renumberDraft(normalizedDraft, orderedWeeks));
  }, [blocks, normalizedDraft, onDraftChange, week?.weekId]);

  const addBlock = useCallback(() => {
    if (weeks.length >= 104 || totalDayCount >= 400) return;
    const blockId = crypto.randomUUID();
    const weekId = crypto.randomUUID();
    let suffix = blocks.length + 1;
    while (blocks.some(block => block.name.trim().toLocaleLowerCase() === `block ${suffix}`)) suffix++;
    const blockName = `Block ${suffix}`;
    const nextWeek = weeks.length + 1;
    const source: Week = { week: nextWeek, sourceWeek: nextWeek, weekId, blockId, days: [], block: blockName, phases: [], pages: [] };
    const day = { ...emptyWeekDay(nextWeek, source, weekId), blockId, weekId, block: blockName };
    setSelectedWeek(nextWeek);
    void onDraftChange(renumberDraft(normalizedDraft, [...weeks, { ...source, days: [day] }]));
  }, [blocks, normalizedDraft, onDraftChange, totalDayCount, weeks]);

  const commitBlockName = useCallback(() => {
    if (!renameBlock || !renameValue.trim()) return;
    const name = renameValue.trim();
    if (name.length > 80 || blocks.some(block => block.id !== renameBlock.id
      && block.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) return;
    setRenameBlock(null);
    void onDraftChange({
      ...normalizedDraft,
      workouts: normalizedDraft.workouts.map(day => day.blockId === renameBlock.id ? { ...day, block: name } : day)
    });
  }, [blocks, normalizedDraft, onDraftChange, renameBlock, renameValue]);

  const deleteBlock = useCallback((blockId: string) => {
    if (blocks.length <= 1) return;
    const index = weeks.findIndex(entry => entry.blockId === blockId);
    const remaining = weeks.filter(entry => entry.blockId !== blockId);
    setDeleteConfirmBlock(null);
    setSelectedWeek(Math.max(1, index));
    void onDraftChange(renumberDraft(normalizedDraft, remaining));
  }, [blocks.length, normalizedDraft, onDraftChange, weeks]);

  const addWeek = useCallback((mode: AddWeekMode) => {
    setWeekModalOpen(false);
    if (!week) return;
    const addedDays = mode === 'duplicate-current' ? week.days.length : 1;
    if (weeks.length >= 104 || totalDayCount + addedDays > 400) return;
    const targetBlockWeeks = weeks.filter(entry => entry.blockId === week.blockId);
    const sourceWeek = mode === 'duplicate-current' ? week : (targetBlockWeeks.at(-1) ?? week);
    const sourceIndex = weeks.findIndex(entry => entry.week === sourceWeek.week);
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : weeks.length;
    const nextNumber = insertIndex + 1;
    const days = mode === 'empty'
      ? [emptyWeekDay(nextNumber, sourceWeek, crypto.randomUUID(), (sourceWeek.days[0]?.phaseWeek ?? 0) + 1)]
      : cloneWeekDays(sourceWeek.days, nextNumber, crypto.randomUUID());
    const weekId = days[0]?.weekId ?? crypto.randomUUID();
    const identifiedDays = days.map(day => ({ ...day, weekId, blockId: sourceWeek.blockId }));
    const nextWeek: Week = {
      week: nextNumber,
      sourceWeek: nextNumber,
      weekId,
      blockId: sourceWeek.blockId,
      days: identifiedDays,
      block: sourceWeek.block || 'Program',
      phases: sourceWeek.phases.slice(0, 1),
      pages: []
    };
    const ordered = [...weeks];
    ordered.splice(insertIndex, 0, nextWeek);
    pendingFocusWeek.current = nextNumber;
    setSelectedWeek(nextNumber);
    void onDraftChange(renumberDraft(normalizedDraft, ordered));
  }, [normalizedDraft, onDraftChange, totalDayCount, week, weeks]);

  const deleteWeek = useCallback((weekToDelete: number) => {
    if (selectedBlockWeeks.length <= 1) return;
    const targetIndex = weeks.findIndex(entry => entry.week === weekToDelete);
    if (targetIndex < 0) return;
    const remainingWeeks = weeks.filter(entry => entry.week !== weekToDelete);
    const nextSelectedWeek = Math.min(targetIndex + 1, remainingWeeks.length);
    pendingFocusWeek.current = nextSelectedWeek;
    setDeleteConfirmWeek(null);
    setSelectedWeek(nextSelectedWeek);
    void onDraftChange(renumberDraft(normalizedDraft, remainingWeeks));
  }, [normalizedDraft, onDraftChange, selectedBlockWeeks.length, weeks]);

  const addDay = useCallback((restDay: boolean) => {
    if (!week || week.days.length >= 7 || totalDayCount >= 400) return;
    const created = restDay ? emptyRestDay(week.week, week) : emptyWeekDay(week.week, week);
    const days = [...week.days, { ...created, block: week.block, blockId: week.blockId, weekId: week.weekId }];
    void onDraftChange(renumberDraft(normalizedDraft, weeks.map(entry =>
      entry.weekId === week.weekId ? { ...entry, days } : entry)));
  }, [normalizedDraft, onDraftChange, totalDayCount, week, weeks]);

  const duplicateDay = useCallback((lineId: string) => {
    if (!week || week.days.length >= 7 || totalDayCount >= 400) return;
    const sourceIndex = week.days.findIndex(day => day.lineId === lineId);
    if (sourceIndex < 0) return;
    const source = week.days[sourceIndex];
    const duplicate: DraftWorkout = {
      ...source,
      lineId: crypto.randomUUID(),
      exercises: source.exercises.map(cloneExercise),
      sourcePage: null
    };
    const days = [...week.days];
    days.splice(sourceIndex + 1, 0, duplicate);
    void onDraftChange(renumberDraft(normalizedDraft, weeks.map(entry =>
      entry.weekId === week.weekId ? { ...entry, days } : entry)));
  }, [normalizedDraft, onDraftChange, totalDayCount, week, weeks]);

  const reorderDay = useCallback((lineId: string, direction: -1 | 1) => {
    if (!week) return;
    const index = week.days.findIndex(day => day.lineId === lineId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= week.days.length) return;
    const days = [...week.days];
    [days[index], days[target]] = [days[target], days[index]];
    void onDraftChange(renumberDraft(normalizedDraft, weeks.map(entry =>
      entry.weekId === week.weekId ? { ...entry, days } : entry)));
  }, [normalizedDraft, onDraftChange, week, weeks]);

  const deleteDay = useCallback((lineId: string) => {
    if (!week || week.days.length <= 1) return;
    const days = week.days.filter(day => day.lineId !== lineId);
    setDeleteConfirmDay(null);
    void onDraftChange(renumberDraft(normalizedDraft, weeks.map(entry =>
      entry.weekId === week.weekId ? { ...entry, days } : entry)));
  }, [normalizedDraft, onDraftChange, week, weeks]);

  const changeDayKind = useCallback((day: DraftWorkout) => {
    if (day.isRestDay) void onDayChange({ ...day, isRestDay: false, name: 'New day', exercises: [blankExercise()] });
    else setRestConfirmDay(day.lineId);
  }, [onDayChange]);

  const confirmRestConversion = useCallback(() => {
    const day = week?.days.find(entry => entry.lineId === restConfirmDay);
    if (day) void onDayChange({ ...day, isRestDay: true, name: 'Rest day', focus: null, notes: null, exercises: [] });
    setRestConfirmDay(null);
  }, [onDayChange, restConfirmDay, week?.days]);

  const moveDayToWeek = useCallback((lineId: string, targetWeekId: string) => {
    const sourceWeek = weeks.find(entry => entry.days.some(day => day.lineId === lineId));
    const targetWeek = weeks.find(entry => entry.weekId === targetWeekId);
    const day = sourceWeek?.days.find(entry => entry.lineId === lineId);
    if (!sourceWeek || !targetWeek || !day || sourceWeek.weekId === targetWeek.weekId
      || sourceWeek.days.length <= 1 || targetWeek.days.length >= 7) return;
    const moved: DraftWorkout = {
      ...day,
      week: targetWeek.week,
      weekId: targetWeek.weekId,
      block: targetWeek.block,
      blockId: targetWeek.blockId,
      phase: targetWeek.phases[0] ?? null,
      phaseWeek: targetWeek.days[0]?.phaseWeek ?? 1
    };
    const ordered = weeks.map(entry => entry.weekId === sourceWeek.weekId
      ? { ...entry, days: entry.days.filter(item => item.lineId !== lineId) }
      : entry.weekId === targetWeek.weekId
        ? { ...entry, days: [...entry.days, moved] }
        : entry).filter(entry => entry.days.length > 0);
    setSelectedWeek(ordered.findIndex(entry => entry.weekId === targetWeek.weekId) + 1);
    void onDraftChange(renumberDraft(normalizedDraft, ordered));
  }, [normalizedDraft, onDraftChange, weeks]);

  return {
    normalizedDraft, weeks, blocks, week, selectedWeek, setSelectedWeek, selectedBlock, selectedBlockIndex,
    selectedBlockWeeks, totalDayCount, canAddDay, weekModalOpen, setWeekModalOpen, deleteConfirmWeek,
    setDeleteConfirmWeek, deleteConfirmBlock, setDeleteConfirmBlock, deleteConfirmDay, setDeleteConfirmDay,
    restConfirmDay, setRestConfirmDay, renameBlock, setRenameBlock, renameValue, setRenameValue,
    draggedWeek, setDraggedWeek, dropTarget, setDropTarget, reorderWeeks, reorderBlocks, addBlock,
    commitBlockName, deleteBlock, addWeek, deleteWeek, addDay, duplicateDay, reorderDay, deleteDay,
    changeDayKind, confirmRestConversion, moveDayToWeek
  };
}
