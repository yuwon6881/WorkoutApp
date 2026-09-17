import { useCallback, useRef, useState } from 'react';
import type { ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { PdfTextError, extractPdfText, type PdfExtraction } from '../lib/pdfText';

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
  chooseAlternative: (view: ImportView, alternativeId: string) => Promise<void>;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

type Options = {
  setSelected: (view: ImportView | null) => void;
  setDraft: (draft: ImportDraft | null) => void;
  onChanged: () => Promise<void>;
};

/// Coordinates the whole read of a PDF: the text is extracted here, on this device, and only that
/// text is sent. The server then reads an outline and one section at a time, and holds the
/// extracted text for a day so a reload continues an unfinished import instead of restarting it.
export function useImportPipeline({ setSelected, setDraft, onChanged }: Options): ImportPipeline {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const running = useRef(false);

  const apply = useCallback((view: ImportView) => { setSelected(view); setDraft(view.draft); }, [setSelected, setDraft]);

  const report = useCallback((error: unknown, fallback: string) => {
    setFailure({ message: error instanceof ApiError || error instanceof PdfTextError ? error.message : fallback });
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
        detail: current.currentChunkLabel ?? '',
        percent: Math.round((current.chunksDone / current.chunksTotal) * 100)
      });
      try {
        current = await api.extractImport(current.id);
      } catch (error) {
        report(error, 'That section could not be read. Try again.');
        await refresh(current.id);
        return;
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

  return {
    progress, failure, notice, busy: progress !== null,
    clearFailure: useCallback(() => setFailure(null), []),
    upload, resume, chooseAlternative, run
  };
}
