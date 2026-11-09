import { useCallback, useRef, useState } from 'react';
import type { ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import {
  checkExternalImportFile, checkExternalImportText, locateParseError, type ExternalImportFieldError, type ParseExcerpt
} from '../lib/externalImport';

/// A short inline busy state: what is being done and, where useful, to which file.
export type ImportProgress = { label: string; detail: string };

export type ImportFailure = { message: string };

/// A rejected AI-assistant JSON file: the summary plus each problem with its location in the file.
export type ExternalImportFailure = { message: string; errors: ExternalImportFieldError[]; excerpt?: ParseExcerpt | null };

export type ImportPipeline = {
  progress: ImportProgress | null;
  failure: ImportFailure | null;
  notice: string;
  externalFailure: ExternalImportFailure | null;
  busy: boolean;
  clearFailure: () => void;
  /// A chosen or dropped .json file, or JSON text pasted into the panel.
  uploadExternal: (source: File | string) => Promise<void>;
  chooseAlternative: (view: ImportView, alternativeId: string) => Promise<void>;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

type Options = {
  setSelected: (view: ImportView | null) => void;
  setDraft: (draft: ImportDraft | null) => void;
  onChanged: () => Promise<void>;
  onComplete?: (count: number) => void;
};

/// Coordinates the short server calls of the import screen. The server converts the JSON while the
/// request is open, so there is nothing to poll: one inline busy state covers each call.
export function useImportPipeline({ setSelected, setDraft, onChanged, onComplete }: Options): ImportPipeline {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const [externalFailure, setExternalFailure] = useState<ExternalImportFailure | null>(null);
  const running = useRef(false);

  const report = useCallback((error: unknown, fallback: string) => {
    setFailure({ message: error instanceof ApiError ? error.message : fallback });
  }, []);

  const advance = useCallback(async (view: ImportView) => {
    setSelected(view); setDraft(view.draft);
    await onChanged();
    if (view.status === 'ready') {
      const count = view.draft?.workouts.length ?? 0;
      setNotice(`Read ${count} days. Review them before accepting.`);
      onComplete?.(count);
    }
  }, [onChanged, onComplete, setDraft, setSelected]);

  const drive = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setFailure(null); setNotice('');
    try { await action(); }
    finally { running.current = false; setProgress(null); }
  }, []);

  /// The sent JSON is validated by the server, which answers with a reviewable draft or the exact
  /// fields to fix. Nothing is created unless the whole file is valid.
  const uploadExternal = useCallback(async (source: File | string) => {
    if (running.current) return;
    setFailure(null); setNotice(''); setExternalFailure(null);
    const pasted = typeof source === 'string';
    const problem = pasted ? checkExternalImportText(source) : checkExternalImportFile(source);
    if (problem) { setExternalFailure({ message: problem, errors: [] }); return; }
    await drive(async () => {
      setProgress({ label: 'Checking the JSON file', detail: pasted ? 'Pasted JSON' : source.name });
      let bytes: Uint8Array;
      // The original bytes are sent either way, so invalid UTF-8 is rejected by the server rather than altered here.
      try { bytes = pasted ? new TextEncoder().encode(source) : new Uint8Array(await source.arrayBuffer()); }
      catch { setExternalFailure({ message: 'That file could not be read. Choose it again.', errors: [] }); return; }
      try {
        setSelected(null); setDraft(null);
        await advance(await api.createExternalImport(bytes));
      } catch (error) {
        setExternalFailure(error instanceof ApiError
          // The offending line is found on this device from the text the user already has.
          ? { message: error.message, errors: error.fieldErrors, excerpt: locateParseError(error.message, new TextDecoder().decode(bytes)) }
          : { message: 'That file could not be imported. Try again.', errors: [] });
      }
    });
  }, [advance, drive, setDraft, setSelected]);

  const chooseAlternative = useCallback(async (view: ImportView, alternativeId: string) => {
    await drive(async () => {
      setProgress({ label: 'Preparing the chosen program', detail: view.fileName });
      try { await advance(await api.selectImportAlternative(view.id, alternativeId, view.draft?.alternativeGroups?.[0]?.id)); }
      catch (error) {
        report(error, 'That program could not be prepared. Try again.');
        try { const latest = await api.getImport(view.id); setSelected(latest); setDraft(latest.draft); } catch { /* the panel keeps the last known view */ }
      }
    });
  }, [advance, drive, report, setDraft, setSelected]);

  const run = useCallback(async (label: string, action: () => Promise<unknown>) => {
    await drive(async () => {
      setProgress({ label, detail: '' });
      try { await action(); await onChanged(); }
      catch (error) { report(error, 'That did not work. Try again.'); }
    });
  }, [drive, onChanged, report]);

  return {
    progress, failure, notice, externalFailure, busy: progress !== null,
    clearFailure: useCallback(() => { setFailure(null); setExternalFailure(null); }, []),
    uploadExternal, chooseAlternative, run
  };
}
