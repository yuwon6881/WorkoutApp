import { useEffect, useRef, useState } from 'react';
import type { Exercise, Program, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { changedDayIds, dayTemplateInput, programToDraft } from '../lib/activeSlot';
import {
  applyFinishPlan, finishPlanEdits, mayHavePlanEdits,
  type FinishPlanScope, type FinishPlanSummary
} from '../lib/finishPlanUpdate';

export type FinishPlanChoice = 'session' | FinishPlanScope;

export type FinishPlanUpdate = {
  status: 'idle' | 'loading' | 'ready';
  summary: FinishPlanSummary | null;
  choice: FinishPlanChoice;
  setChoice: (choice: FinishPlanChoice) => void;
  error: string;
  /** Saves the program days the choice reaches. False when that failed and the finish should wait. */
  apply: () => Promise<boolean>;
};

/// Offers to carry the workout's plan changes into its program when the finish dialog opens. The
/// program is read only when the workout looks changed, and the choice is offered only when the
/// changed movement appears somewhere else in the program.
export function useFinishPlanUpdate(draft: Session, open: boolean, online: boolean, library: Exercise[]): FinishPlanUpdate {
  const [program, setProgram] = useState<Program | null>(null);
  const [summary, setSummary] = useState<FinishPlanSummary | null>(null);
  const [status, setStatus] = useState<FinishPlanUpdate['status']>('idle');
  const [choice, setChoice] = useState<FinishPlanChoice>('session');
  const [error, setError] = useState('');
  // Days already saved for a choice. The changes are relative (a set appended, a set removed), so a
  // retry after a partial failure saves only the rest instead of applying them twice.
  const saved = useRef<{ choice: FinishPlanChoice; days: Set<string> }>({ choice: 'session', days: new Set() });
  const programId = draft.programId;
  const worthChecking = open && online && mayHavePlanEdits(draft);

  useEffect(() => {
    saved.current = { choice: 'session', days: new Set() };
    if (!worthChecking || !programId) {
      setStatus('idle'); setSummary(null); setProgram(null); setChoice('session'); setError('');
      return;
    }
    let current = true;
    setStatus('loading');
    api.getProgram(programId).then(loaded => {
      if (!current) return;
      const found = finishPlanEdits(draft, programToDraft(loaded));
      setProgram(loaded);
      setSummary(found.edits.length > 0 && found.counts.program > 0 ? found : null);
      setStatus('ready');
    }).catch(() => {
      // The finish never depends on this offer; without the program there is simply nothing to offer.
      if (current) { setSummary(null); setStatus('ready'); }
    });
    return () => { current = false; };
    // One look when the dialog opens: the workout cannot be edited while the dialog is up.
  }, [worthChecking, programId]);

  async function apply(): Promise<boolean> {
    if (choice === 'session' || !summary || !program) return true;
    setError('');
    if (saved.current.days.size > 0 && saved.current.choice !== choice) {
      setError('Part of the program was already updated. Try the same choice again, or save the workout without further program changes.');
      return false;
    }
    saved.current.choice = choice;
    const before = programToDraft(program);
    const after = applyFinishPlan(before, summary.edits, choice, library);
    let revisions = new Map(program.workouts.map(workout => [workout.id, workout.revision]));
    if (saved.current.days.size > 0) {
      // A retry: the days saved last time moved on a revision, and the rest may have too.
      try { revisions = new Map((await api.getProgram(program.id)).workouts.map(workout => [workout.id, workout.revision])); }
      catch { /* the saves below report the failure */ }
    }
    try {
      for (const dayId of changedDayIds(before, after)) {
        if (saved.current.days.has(dayId)) continue;
        const day = after.workouts.find(workout => workout.lineId === dayId);
        const revision = revisions.get(dayId);
        if (!day || revision === undefined) continue;
        await api.updateTemplate(dayId, dayTemplateInput(day, revision));
        saved.current.days.add(dayId);
      }
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError
        ? `The program was not updated: ${failure.message}`
        : 'The program could not be updated. Try again, or save the workout without changing the program.');
      return false;
    }
  }

  return { status, summary, choice, setChoice, error, apply };
}
