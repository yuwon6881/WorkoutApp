import { useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import { api } from '../lib/api';
import type { FinishPlanScope } from '../lib/finishPlanUpdate';
import type { FinishPlanPreview, FinishPlanUpdateInput } from '../lib/finishPlanContract';

export type FinishPlanChoice = 'session' | FinishPlanScope;
export type FinishPlanUpdate = {
  status: 'idle' | 'loading' | 'ready'; summary: FinishPlanPreview | null;
  choice: FinishPlanChoice; setChoice: (choice: FinishPlanChoice) => void;
  error: string; retry: () => void; input: FinishPlanUpdateInput | undefined;
  apply: () => Promise<boolean>;
};

// Flush the durable workout before previewing. The server owns the changed-field deltas,
// affected days and revisions, and applies them in the finish transaction.
export function useFinishPlanUpdate(draft: Session, open: boolean, online: boolean, ensureSaved: () => Promise<void>): FinishPlanUpdate {
  const [summary, setSummary] = useState<FinishPlanPreview | null>(null);
  const [status, setStatus] = useState<FinishPlanUpdate['status']>('idle');
  const [choice, setChoice] = useState<FinishPlanChoice>('session');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const save = useRef(ensureSaved);
  save.current = ensureSaved;
  // The restore flag belongs to the last server response and can still be false while a
  // changed plan is saving. Always settle those saves before deciding whether to offer review.
  const worthChecking = open && online && Boolean(draft.programId);
  useEffect(() => {
    setChoice('session'); setError(''); setSummary(null);
    if (!worthChecking) { setStatus('idle'); return; }
    let current = true;
    setStatus('loading');
    save.current().then(() => api.previewFinishPlan(draft.id)).then(preview => {
      if (!current) return;
      setSummary(preview.edits.length > 0 && preview.counts.program > 0 ? preview : null);
      setStatus('ready');
    }).catch(failure => {
      if (!current) return;
      setError(failure instanceof Error ? failure.message : 'Could not review program changes.');
      setStatus('ready');
    });
    return () => { current = false; };
  }, [worthChecking, draft.id, attempt]);
  const input = choice !== 'session' && summary ? {
    scope: choice, changesHash: summary.changesHash, programRevision: summary.programRevision,
    dayRevisions: summary.dayRevisions
  } : undefined;
  return { status, summary, choice, setChoice, error, input, retry: () => setAttempt(value => value + 1),
    apply: async () => status !== 'loading' && (choice === 'session' || input !== undefined) };
}
