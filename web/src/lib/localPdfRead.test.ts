import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportView } from '../types';
import { api } from './api';
import { extractPdfText } from './pdfText';
import { cancelLocalPdfRead, localPdfRead, resetLocalPdfRead, startLocalPdfRead, takeLocalPdfResult } from './localPdfRead';

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  api: { createImport: vi.fn() }
}));

vi.mock('./pdfText', () => ({
  PdfTextError: class PdfTextError extends Error {},
  extractPdfText: vi.fn()
}));

const file = new File(['%PDF'], 'Program.pdf', { type: 'application/pdf' });
const source = { pageCount: 2, pagesWithText: 2, pages: [], links: [] };

describe('local PDF read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLocalPdfRead();
  });

  it('reports page progress outside any screen and keeps the created import until it is taken', async () => {
    let finishReading!: () => void;
    vi.mocked(extractPdfText).mockImplementation(async (_file, onPage) => {
      onPage?.(1, 2);
      await new Promise<void>(resolve => { finishReading = resolve; });
      return source as never;
    });
    const view = { id: 'import-1' } as ImportView;
    vi.mocked(api.createImport).mockResolvedValue(view);

    const run = startLocalPdfRead(file);
    expect(localPdfRead()).toMatchObject({ status: 'reading', progress: { detail: 'Page 1 of 2', percent: 50 } });
    // A second choice while one is being read does not start another.
    await startLocalPdfRead(file);
    expect(extractPdfText).toHaveBeenCalledTimes(1);
    expect(takeLocalPdfResult()).toBeNull();

    finishReading();
    await run;
    expect(localPdfRead()).toEqual({ status: 'created', fileName: 'Program.pdf', view });
    expect(takeLocalPdfResult()).toEqual({ status: 'created', fileName: 'Program.pdf', view });
    expect(takeLocalPdfResult()).toBeNull();
  });

  it('settles as cancelled when the read is cancelled', async () => {
    vi.mocked(extractPdfText).mockImplementation((_file, _onPage, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

    const run = startLocalPdfRead(file);
    cancelLocalPdfRead();
    await run;

    expect(takeLocalPdfResult()).toEqual({ status: 'cancelled', fileName: 'Program.pdf' });
    expect(api.createImport).not.toHaveBeenCalled();
  });

  it('keeps a failure to send the text for whoever is on screen', async () => {
    vi.mocked(extractPdfText).mockResolvedValue(source as never);
    vi.mocked(api.createImport).mockRejectedValue(new Error('network'));

    await startLocalPdfRead(file);

    expect(takeLocalPdfResult()).toEqual({ status: 'failed', fileName: 'Program.pdf', message: 'Could not read that PDF.' });
  });
});
