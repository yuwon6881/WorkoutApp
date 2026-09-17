import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { PdfTextError, extractPdfText, type PdfExtraction } from '../lib/pdfText';
import { soundNow } from '../lib/alarm';

/// `percent` is null while the step has no measurable size, so the bar can stay indeterminate
/// instead of inventing a number.
export type ImportProgress = { label: string; detail: string; percent: number | null };

export type ImportFailure = { message: string };

export type ImportPipeline = {
  progress: ImportProgress | null;
  failure: ImportFailure | null;
  notice: string;
  busy: boolean;
  clearFailure: () => void;
  upload: (chosen: File) => Promise<void>;
  resume: (view: ImportView) => Promise<void>;
  cancel: (view: ImportView) => Promise<void>;
  chooseAlternative: (view: ImportView, alternativeId: string) => Promise<void>;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

type Options = {
  /// The import this screen is showing, so an unfinished read can continue on its own.
  selected?: ImportView | null;
  setSelected: (view: ImportView | null) => void;
  setDraft: (draft: ImportDraft | null) => void;
  onChanged: () => Promise<void>;
  onComplete?: (count: number) => void;
};

/// Coordinates the whole read of a PDF: the text is extracted here, on this device, and only that
/// text is sent. The server then reads an outline and one section at a time, and holds the
/// extracted text for a day so a reload continues an unfinished import instead of restarting it.
export function useImportPipeline({ selected, setSelected, setDraft, onChanged, onComplete }: Options): ImportPipeline {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  /// An import someone cancelled while a pass was still out. Whatever that pass answers belongs to
  /// something the user has already thrown away, so it must not reappear on screen.
  const cancelled = useRef<string | null>(null);
  /// Imports this screen has already continued by itself, so a read that keeps failing is never
  /// retried forever without anyone asking.
  const resumed = useRef(new Set<string>());

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

  const extractAll = useCallback(async (start: ImportView) => {
    let current = start;
    while (current.status === 'pending' && current.stage === 'extract' && current.chunksDone < current.chunksTotal) {
      setProgress({
        label: `Reading section ${current.chunksDone + 1} of ${current.chunksTotal}`,
        detail: current.currentChunkLabel ?? '',
        percent: Math.round((current.chunksDone / current.chunksTotal) * 100)
      });
      try {
        current = await api.extractImport(current.id);
      } catch (error) {
        reportFor(current.id, error, 'That section could not be read. Try again.');
        if (cancelled.current !== current.id) await refresh(current.id);
        return;
      }
      apply(current);
      await onChanged();
    }
    if (current.status === 'ready') {
      soundNow();
      const count = current.draft?.workouts.length ?? 0;
      setNotice(`Read ${count} days. Review them before accepting.`);
      onComplete?.(count);
    }
  }, [apply, onChanged, onComplete, refresh, reportFor]);

  const advance = useCallback(async (view: ImportView) => {
    apply(view);
    await onChanged();
    if (view.stage === 'extract') await extractAll(view);
    else if (view.status === 'ready') {
      soundNow();
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
    finally { running.current = false; setProgress(null); }
  }, []);

  const upload = useCallback(async (chosen: File) => {
    if (!/\.pdf$/i.test(chosen.name)) { setFailure({ message: 'Choose a PDF file.' }); return; }
    await drive(async () => {
      let source: PdfExtraction;
      try {
        // Reading the text is the only step whose size this app knows, so it is the only step
        // that reports a real percentage.
        setProgress({ label: 'Reading the PDF on this device', detail: chosen.name, percent: 0 });
        source = await extractPdfText(chosen, (page, pageCount) => {
          setProgress({ label: 'Reading the PDF on this device', detail: `Page ${page} of ${pageCount}`, percent: Math.round((page / pageCount) * 100) });
        });
      } catch (error) { report(error, 'The text in that PDF could not be read on this device.'); return; }

      try {
        setProgress({
          label: 'Finding the program',
          detail: `${source.pagesWithText} of ${source.pageCount} pages have selectable text`,
          percent: null
        });
        await advance(await api.createImport(source));
      } catch (error) { report(error, 'Could not read that PDF.'); }
    });
  }, [advance, drive, report]);

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
    resumed.current.delete(view.id);
    setFailure(null); setNotice(''); setProgress(null);
    try {
      await api.discardImport(view.id);
      setSelected(null); setDraft(null);
      await onChanged();
      setNotice('That import was cancelled. Choose a PDF to start again.');
    } catch (error) { report(error, 'That import could not be cancelled. Try again.'); }
  }, [onChanged, report, setDraft, setSelected]);

  /// An unfinished read continues by itself when this screen opens, so nobody has to press
  /// anything to pick a read back up. A read that already failed is left alone: it said why, and
  /// spending another read on it is the user's call rather than this screen's.
  useEffect(() => {
    if (!selected || selected.status !== 'pending' || selected.stage === 'select') return;
    if (!selected.sourceExpiresAt || selected.error || running.current) return;
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
    progress, failure, notice, busy: progress !== null,
    clearFailure: useCallback(() => setFailure(null), []),
    upload, resume, cancel, chooseAlternative, run
  };
}
