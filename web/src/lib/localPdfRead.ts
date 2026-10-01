import { useSyncExternalStore } from 'react';
import type { ImportView } from '../types';
import { ApiError, api } from './api';
import { PdfTextError, extractPdfText } from './pdfText';

export type LocalPdfProgress = { label: string; detail: string; percent: number | null };

/// The on-device half of an import: the PDF's text is read here, then sent to become a server
/// import. It lives outside the import screen so leaving that screen neither abandons the read nor
/// hides it; the server row only exists once the text has been sent, so until then this is the
/// one place that knows a read is under way.
export type LocalPdfRead =
  | { status: 'reading' | 'submitting'; fileName: string; progress: LocalPdfProgress }
  | { status: 'created'; fileName: string; view: ImportView }
  | { status: 'failed'; fileName: string; message: string }
  | { status: 'cancelled'; fileName: string }
  | null;

export const LOCAL_READ_LABEL = 'Reading the PDF on this device';

let state: LocalPdfRead = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function set(next: LocalPdfRead) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function localPdfRead(): LocalPdfRead {
  return state;
}

export function useLocalPdfRead(): LocalPdfRead {
  return useSyncExternalStore(subscribe, localPdfRead, localPdfRead);
}

export function isLocalPdfReadActive(read: LocalPdfRead): read is Extract<NonNullable<LocalPdfRead>, { status: 'reading' | 'submitting' }> {
  return read?.status === 'reading' || read?.status === 'submitting';
}

function failure(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof PdfTextError ? error.message : fallback;
}

/// Starts reading a PDF unless one is already being read. The outcome stays here until whoever is
/// on screen takes it: the import screen continues into the server read, anywhere else the shell
/// hands the new import to its background watcher.
export async function startLocalPdfRead(file: File): Promise<void> {
  if (isLocalPdfReadActive(state)) return;
  const reading = new AbortController();
  controller = reading;
  const fileName = file.name;
  set({ status: 'reading', fileName, progress: { label: LOCAL_READ_LABEL, detail: fileName, percent: 0 } });

  const current = () => controller === reading;
  try {
    // Reading the text is the only step whose size this app knows, so it is the only step that
    // reports a real percentage.
    const source = await extractPdfText(file, (page, pageCount) => {
      if (!current() || reading.signal.aborted) return;
      set({ status: 'reading', fileName, progress: {
        label: LOCAL_READ_LABEL, detail: `Page ${page} of ${pageCount}`, percent: Math.round((page / pageCount) * 100)
      } });
    }, reading.signal);
    if (!current()) return;
    if (reading.signal.aborted) { set({ status: 'cancelled', fileName }); return; }

    set({ status: 'submitting', fileName, progress: {
      label: 'Finding the program',
      detail: `${source.pagesWithText} of ${source.pageCount} pages have selectable text`,
      percent: null
    } });
    try {
      const view = await api.createImport(source);
      if (current()) set({ status: 'created', fileName, view });
    } catch (error) {
      if (current()) set({ status: 'failed', fileName, message: failure(error, 'Could not read that PDF.') });
    }
  } catch (error) {
    if (!current()) return;
    set(reading.signal.aborted
      ? { status: 'cancelled', fileName }
      : { status: 'failed', fileName, message: failure(error, 'The text in that PDF could not be read on this device.') });
  } finally {
    if (current()) controller = null;
  }
}

/// Cancelling is only possible while the text is still being read; once it is being sent the
/// server row is the thing to cancel.
export function cancelLocalPdfRead() {
  if (state?.status !== 'reading') return;
  controller?.abort();
}

/// Hands over a finished read exactly once, so the screen and the shell never both act on it.
export function takeLocalPdfResult(): Exclude<LocalPdfRead, { status: 'reading' | 'submitting' } | null> | null {
  const settled = state;
  if (!settled || isLocalPdfReadActive(settled)) return null;
  set(null);
  return settled;
}

/// Signing out ends whatever this device was reading for the previous account.
export function resetLocalPdfRead() {
  controller?.abort();
  controller = null;
  set(null);
}
