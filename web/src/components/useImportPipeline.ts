import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { PdfTextError } from '../lib/pdfText';
import { cancelLocalPdfRead, isLocalPdfReadActive, startLocalPdfRead, takeLocalPdfResult, useLocalPdfRead } from '../lib/localPdfRead';

/// `percent` is null while the step has no measurable size, so the bar can stay indeterminate
/// instead of inventing a number.
export type ImportProgress = { label: string; detail: string; percent: number | null };

export type ImportFailure = { message: string };

const POLL_INTERVAL_MS = 2_000;
const STALL_INTERVAL_MS = 90_000;

export type ImportPipeline = {
  progress: ImportProgress | null;
  uploadProgress: ImportProgress | null;
  failure: ImportFailure | null;
  notice: string;
  busy: boolean;
  clearFailure: () => void;
  upload: (chosen: File) => Promise<void>;
  cancelUpload: () => void;
  resume: (view: ImportView) => Promise<void>;
  cancel: (view: ImportView) => Promise<void>;
  chooseAlternative: (view: ImportView, alternativeId: string) => Promise<void>;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

type Options = {
  selected: ImportView | null;
  setSelected: (view: ImportView | null) => void;
  setDraft: (draft: ImportDraft | null) => void;
  onChanged: () => Promise<void>;
  onComplete?: (count: number) => void;
};

/// Coordinates the whole read of a PDF: the text is extracted here, on this device, and only that
/// text is sent. The server reads the outline and sections in its background runner while this hook
/// polls persisted progress.
export function useImportPipeline({ selected, setSelected, setDraft, onChanged, onComplete }: Options): ImportPipeline {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const idleWaiters = useRef<Array<() => void>>([]);
  /// An import someone cancelled while a pass was still out. Whatever that pass answers belongs to
  /// something the user has already thrown away, so it must not reappear on screen.
  const cancelled = useRef<string | null>(null);
  /// Imports this screen has already continued by itself, so a read that keeps failing is never
  /// retried forever without anyone asking.
  const resumed = useRef(new Set<string>());
  const statusEtags = useRef(new Map<string, string>());
  const pollAbort = useRef<AbortController | null>(null);
  const localRead = useLocalPdfRead();
  const uploadProgress = isLocalPdfReadActive(localRead) ? localRead.progress : null;

  // Leaving the screen stops only this screen's polling. The on-device read belongs to the app
  // shell and keeps going, and the server keeps reading a submitted import either way.
  useEffect(() => () => { pollAbort.current?.abort(); }, []);
  const apply = useCallback((view: ImportView) => {
    if (cancelled.current === view.id) return;
    setSelected(view); setDraft(view.draft);
  }, [setSelected, setDraft]);

  const report = useCallback((error: unknown, fallback: string) => {
    setFailure({ message: error instanceof ApiError || error instanceof PdfTextError ? error.message : fallback });
  }, []);

  /// A failure that belongs to a cancelled import is not news; everything else is reported.
  const reportFor = useCallback((id: string, error: unknown, fallback: string) => {
    if (cancelled.current === id) return;
    report(error, fallback);
  }, [report]);

  /// Refreshes the row after a failed pass so the panel shows what the server recorded rather
  /// than the view this browser happened to be holding.
  const refresh = useCallback(async (id: string) => {
    try { apply(await api.getImport(id)); } catch { /* the panel keeps the last known view */ }
  }, [apply]);

  const poll = useCallback(async (current: ImportView): Promise<ImportView> => {
    const meta = await api.getImportStatusMeta(current.id, statusEtags.current.get(current.id), pollAbort.current?.signal);
    if (meta.etag) statusEtags.current.set(current.id, meta.etag);
    if (meta.notModified || !meta.data) return current;
    const status = meta.data;
    const lightweight: ImportView = { ...current, ...status };
    // A completed draft or an alternative choice carries data that is deliberately omitted from
    // the polling contract. Fetch it once at the transition instead of transferring it every two
    // seconds while the model is still working.
    if (status.status === 'ready' || status.stage === 'select' || status.status === 'failed')
      return api.getImport(current.id);
    return lightweight;
  }, []);

  const extractAll = useCallback(async (start: ImportView) => {
    pollAbort.current?.abort();
    const controller = new AbortController(); pollAbort.current = controller;
    let current = start;
    let transportFailures = 0;
    let lastDone = current.chunksDone;
    let lastServerProgress = current.progress?.lastProgressAtUtc ?? null;
    let lastProgressAt = Date.now();

    const showProgress = (view: ImportView) => {
      const remaining = Math.max(0, view.chunksTotal - view.chunksDone);
      setProgress({
        label: view.stage === 'outline'
          ? 'Reading the outline'
          : view.stage === 'verify'
            ? 'Checking extracted details against the PDF'
            : view.stage === 'recover'
              ? 'Repairing source discrepancies'
              : remaining > 1 ? `Reading ${remaining} sections` : 'Reading the last section',
        detail: view.stage === 'verify'
          ? `${view.progress?.sectionsWithResponses ?? 0} section responses saved; comparing sessions, exercises, sets, and prescriptions with printed evidence.`
          : view.stage === 'recover'
            ? `${view.progress?.sectionsWithResponses ?? 0} section responses saved; re-reading only source discrepancies.`
            : remaining > 1 ? 'Sections commit in order as they land.' : view.currentChunkLabel ?? '',
        percent: view.stage === 'verify' || view.stage === 'recover'
          ? null
          : view.chunksTotal > 0 ? Math.min(99, Math.round((view.chunksDone / view.chunksTotal) * 100)) : null
      });
    };

    showProgress(current);
    try {
      // The POST only kicks the server-side pass. It is intentionally not held open while model
      // calls run behind the Vercel proxy.
      current = await api.extractImport(current.id);
      apply(current);
      showProgress(current);

      while (!controller.signal.aborted && current.status === 'pending' && current.stage !== 'select') {
        if (controller.signal.aborted || cancelled.current === current.id) return;
        await new Promise(resolve => window.setTimeout(resolve, Math.min(16_000, POLL_INTERVAL_MS * 2 ** transportFailures)));
        if (controller.signal.aborted || cancelled.current === current.id) return;
        try {
          current = await poll(current);
          transportFailures = 0;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && (error.offline || error.status >= 500) && ++transportFailures <= 4) continue;
          reportFor(current.id, error, 'The import progress could not be loaded. Try again.');
          if (cancelled.current !== current.id) await refresh(current.id);
          return;
        }
        if (cancelled.current === current.id) return;
        apply(current);
        showProgress(current);

        if ((current.progress?.lastProgressAtUtc && current.progress.lastProgressAtUtc !== lastServerProgress)
          || current.chunksDone > lastDone) {
          lastServerProgress = current.progress?.lastProgressAtUtc ?? lastServerProgress;
          lastDone = current.chunksDone;
          lastProgressAt = Date.now();
        }
        if (current.error) {
          reportFor(current.id, new Error(current.error), current.error);
          return;
        }
        if (current.status !== 'pending' || current.stage === 'select') break;

        if (Date.now() - lastProgressAt >= STALL_INTERVAL_MS) {
          // A recycled scale-to-zero instance has no in-memory pass left. Kicking again is safe
          // when the original is still alive because ImportRunner coalesces the duplicate.
          try {
            current = await api.extractImport(current.id);
            if (cancelled.current === current.id) return;
            apply(current);
            showProgress(current);
          } catch (error) {
            reportFor(current.id, error, 'That import could not be restarted. Try again.');
            return;
          }
          lastProgressAt = Date.now();
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      reportFor(current.id, error, 'That import could not be started. Try again.');
      if (cancelled.current !== current.id) await refresh(current.id);
      return;
    }

    if (current.status === 'ready' && cancelled.current !== current.id) {
      await onChanged();
      const count = current.draft?.workouts.length ?? 0;
      setNotice(`Read ${count} days. Review them before accepting.`);
      onComplete?.(count);
    }
  }, [apply, onChanged, onComplete, poll, refresh, reportFor]);

  const advance = useCallback(async (view: ImportView) => {
    apply(view);
    await onChanged();
    if (view.status === 'pending' && view.stage !== 'select') await extractAll(view);
    else if (view.status === 'ready') {
      const count = view.draft?.workouts.length ?? 0;
      setNotice(`Read ${count} days. Review them before accepting.`);
      onComplete?.(count);
    }
  }, [apply, extractAll, onComplete, onChanged]);

  const drive = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setFailure(null); setNotice('');
    try { await action(); }
    finally {
      running.current = false; setProgress(null);
      for (const resume of idleWaiters.current.splice(0)) resume();
    }
  }, []);

  const upload = useCallback(async (chosen: File) => {
    if (running.current) return;
    setFailure(null); setNotice('');
    setSelected(null); setDraft(null);
    if (!/\.pdf$/i.test(chosen.name)) { setFailure({ message: 'Choose a PDF file.' }); return; }
    await startLocalPdfRead(chosen);
  }, [setDraft, setSelected]);

  /// A read that finished while this screen is open continues here; one that finished while it was
  /// closed was already handed to the shell's watcher and arrives through the import list instead.
  useEffect(() => {
    if (!localRead || isLocalPdfReadActive(localRead) || running.current) return;
    const settled = takeLocalPdfResult();
    if (!settled) return;
    if (settled.status === 'cancelled') setNotice('PDF reading was cancelled. Choose a PDF to start again.');
    else if (settled.status === 'failed') setFailure({ message: settled.message });
    else void drive(() => advance(settled.view));
  // `progress` re-runs this once a pass that was already running lets go of the screen.
  }, [advance, drive, localRead, progress]);

  const cancelUpload = useCallback(() => { cancelLocalPdfRead(); }, []);

  const resume = useCallback(async (view: ImportView) => {
    await drive(async () => {
      setProgress({ label: 'Continuing the saved read', detail: view.fileName, percent: null });
      try { await advance(await api.retryImport(view.id)); }
      catch (error) {
        reportFor(view.id, error, 'That import could not be continued. Try again.');
        if (cancelled.current !== view.id) await refresh(view.id);
      }
    });
  }, [advance, drive, refresh, reportFor]);

  /// Throws the import away, whether or not a read is still out for it. Cancelling mid-read is
  /// exactly when someone realises they picked the wrong file, so it does not wait its turn behind
  /// the pass in flight: the server finds no row to commit to and the draft never appears.
  const cancel = useCallback(async (view: ImportView) => {
    cancelled.current = view.id;
    pollAbort.current?.abort();
    resumed.current.delete(view.id);
    setFailure(null); setNotice(''); setProgress(null);
    try {
      await api.discardImport(view.id);
      setSelected(null); setDraft(null);
      await onChanged();
      setNotice('That import was cancelled.');
    } catch (error) { report(error, 'That import could not be cancelled. Try again.'); }
  }, [onChanged, report, setDraft, setSelected]);

  /// An unfinished read continues by itself when this screen opens, so nobody has to press
  /// anything to pick a read back up. A read that already failed is left alone: it said why, and
  /// spending another read on it is the user's call rather than this screen's.
  useEffect(() => {
    if (!selected || selected.status !== 'pending' || selected.stage === 'select') return;
    if (selected.error || running.current) return;
    if (resumed.current.has(selected.id)) return;
    resumed.current.add(selected.id);
    void resume(selected);
  }, [selected, resume]);

  const chooseAlternative = useCallback(async (view: ImportView, alternativeId: string) => {
    await drive(async () => {
      setProgress({ label: 'Preparing the chosen program', detail: view.fileName, percent: null });
      try { await advance(await api.selectImportAlternative(view.id, alternativeId)); }
      catch (error) { report(error, 'That program could not be prepared. Try again.'); await refresh(view.id); }
    });
  }, [advance, drive, refresh, report]);

  const run = useCallback(async (label: string, action: () => Promise<unknown>) => {
    await drive(async () => {
      setProgress({ label, detail: '', percent: null });
      try { await action(); await onChanged(); }
      catch (error) { report(error, 'That did not work. Try again.'); }
    });
  }, [drive, onChanged, report]);

  return {
    progress, uploadProgress, failure, notice, busy: progress !== null || uploadProgress !== null,
    clearFailure: useCallback(() => setFailure(null), []),
    upload, cancelUpload, resume, cancel, chooseAlternative, run
  };
}
