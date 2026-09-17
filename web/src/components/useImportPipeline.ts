import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';

export const MAX_IMPORT_BYTES = 150 * 1024 * 1024;
const RESUMABLE_THRESHOLD = 8 * 1024 * 1024;
const POLL_MS = 4000;

/// `percent` is null while the step has no measurable size, so the bar can stay indeterminate
/// instead of inventing a number.
export type ImportProgress = { label: string; detail: string; percent: number | null };

/// `needsSource` marks the one failure the user alone can clear: the server no longer holds the
/// PDF, so nothing but the file itself moves the import forward.
export type ImportFailure = { message: string; needsSource: boolean };

export type ImportPipeline = {
  progress: ImportProgress | null;
  failure: ImportFailure | null;
  notice: string;
  busy: boolean;
  clearFailure: () => void;
  upload: (chosen: File) => Promise<void>;
  resume: (view: ImportView) => Promise<void>;
  chooseAlternative: (view: ImportView, alternativeId: string) => Promise<void>;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

type Options = {
  selected: ImportView | null;
  setSelected: (view: ImportView | null) => void;
  setDraft: (draft: ImportDraft | null) => void;
  onChanged: () => Promise<void>;
};

/// Coordinates the whole read of a PDF: upload, outline, and one extraction pass per section.
/// The server owns the work and can finish it without this tab, so the browser reports progress,
/// resumes what it can, and only asks for the file again when the server truly cannot continue.
export function useImportPipeline({ selected, setSelected, setDraft, onChanged }: Options): ImportPipeline {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const sourceFile = useRef<File | null>(null);
  const running = useRef(false);

  const apply = useCallback((view: ImportView) => { setSelected(view); setDraft(view.draft); }, [setSelected, setDraft]);

  const report = useCallback((error: unknown, fallback: string) => {
    setFailure({
      message: error instanceof ApiError ? error.message : fallback,
      needsSource: error instanceof ApiError && error.status === 410
    });
  }, []);

  /// Refreshes the row after a failed pass so the panel shows what the server recorded rather
  /// than the view this browser happened to be holding.
  const refresh = useCallback(async (id: string) => {
    try { apply(await api.getImport(id)); } catch { /* the panel keeps the last known view */ }
  }, [apply]);

  const extractAll = useCallback(async (start: ImportView) => {
    let current = start;
    while (current.status === 'pending' && current.stage === 'extract' && current.chunksDone < current.chunksTotal) {
      setProgress({
        label: `Reading section ${current.chunksDone + 1} of ${current.chunksTotal}`,
        detail: current.currentChunkLabel ?? 'The server keeps this section even if you leave.',
        percent: Math.round((current.chunksDone / current.chunksTotal) * 100)
      });
      try {
        current = await api.extractImport(current.id);
      } catch (error) {
        const expired = error instanceof ApiError && error.status === 410;
        const held = sourceFile.current;
        // Sending an empty file would only repeat the same "temporary PDF has expired" answer,
        // so the copy this browser still has is the only worthwhile retry.
        if (!expired || !held) { report(error, 'That section could not be read. Try again.'); await refresh(current.id); return; }
        try { current = await api.extractImport(current.id, held); }
        catch (retryError) { report(retryError, 'That section could not be read. Try again.'); await refresh(current.id); return; }
      }
      apply(current);
      await onChanged();
    }
    if (current.status === 'ready') setNotice(`Read ${current.draft?.workouts.length ?? 0} days. Review them before accepting.`);
  }, [apply, onChanged, refresh, report]);

  const advance = useCallback(async (view: ImportView) => {
    apply(view);
    await onChanged();
    if (view.stage === 'extract') await extractAll(view);
    else if (view.status === 'ready') setNotice(`Read ${view.draft?.workouts.length ?? 0} days. Review them before accepting.`);
  }, [apply, extractAll, onChanged]);

  const drive = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setFailure(null); setNotice('');
    try { await action(); }
    finally { running.current = false; setProgress(null); }
  }, []);

  const upload = useCallback(async (chosen: File) => {
    if (chosen.size > MAX_IMPORT_BYTES) { setFailure({ message: 'That PDF is larger than 150 MiB.', needsSource: false }); return; }
    if (!/\.pdf$/i.test(chosen.name)) { setFailure({ message: 'Choose a PDF file.', needsSource: false }); return; }
    sourceFile.current = chosen;
    await drive(async () => {
      try {
        let view: ImportView;
        if (chosen.size > RESUMABLE_THRESHOLD) {
          setProgress({ label: 'Uploading the PDF', detail: chosen.name, percent: 0 });
          const session = await api.initImportUpload(chosen.name, chosen.size);
          let offset = session.receivedBytes;
          while (offset < chosen.size) {
            const end = Math.min(chosen.size, offset + session.chunkBytes);
            const part = new Uint8Array(await chosen.slice(offset, end).arrayBuffer());
            const sent = await api.appendImportUpload(session.id, offset, part);
            offset = sent.receivedBytes;
            setProgress({ label: 'Uploading the PDF', detail: chosen.name, percent: Math.round((offset / chosen.size) * 100) });
          }
          setProgress({ label: 'Reading the program outline', detail: chosen.name, percent: null });
          view = await api.completeImportUpload(session.id);
        } else {
          setProgress({ label: 'Reading the program outline', detail: chosen.name, percent: null });
          view = await api.uploadImport(chosen);
        }
        await advance(view);
      } catch (error) { report(error, 'Could not read that PDF.'); }
    });
  }, [advance, drive, report]);

  const resume = useCallback(async (view: ImportView) => {
    await drive(async () => {
      setProgress({ label: 'Continuing the saved read', detail: view.fileName, percent: null });
      try { await advance(await api.retryImport(view.id)); }
      catch (error) { report(error, 'That import could not be continued. Try again.'); await refresh(view.id); }
    });
  }, [advance, drive, refresh, report]);

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

  const pendingId = selected?.status === 'pending' ? selected.id : null;
  useEffect(() => {
    if (!pendingId) return;
    // Extraction also runs on the server, so an import can finish while this tab is idle. Polling
    // keeps the panel honest without asking the user to press anything.
    const timer = window.setInterval(async () => {
      if (running.current || document.hidden) return;
      try {
        const view = await api.getImport(pendingId);
        apply(view);
        if (view.status !== 'pending') await onChanged();
      } catch { /* a single missed poll is not worth reporting; the next tick retries */ }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pendingId, apply, onChanged]);

  return {
    progress, failure, notice, busy: progress !== null,
    clearFailure: useCallback(() => setFailure(null), []),
    upload, resume, chooseAlternative, run
  };
}
