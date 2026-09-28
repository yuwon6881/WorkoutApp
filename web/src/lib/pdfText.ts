import { MAX_PDF_LINKS, pageLinks, preferredPageLinks, printedLinks, type LinkRect, type PdfLink } from './pdfLinks';
import type { TextPiece } from './pdfGeometry';
import { PdfPageReconstructor } from './pdfPageReconstructor';
export { buildPageText } from './pdfPageText';

/// Mirrors the server's bounds in `ImportSourceText`, so a document the browser accepts is a
/// document the API accepts.
export const MAX_PDF_PAGES = 1000;
const MAX_PAGE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 2_000_000;
const PDF_PAGE_BATCH_SIZE = 2;

/// Keep page decoding sequential on phones and low-resource devices. Desktop reads can overlap
/// two pages to hide pdf.js page-loading waits without creating a large canvas/text memory spike.
function pdfPageBatchSize() {
  if (typeof navigator === 'undefined') return 1;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  const fewCores = nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
  return mobile || lowMemory || fewCores ? 1 : PDF_PAGE_BATCH_SIZE;
}

export type PdfPageText = { page: number; text: string };
export type PdfExtraction = {
  fileName: string; pageCount: number; pages: PdfPageText[]; pagesWithText: number;
  /// Demonstration videos the document links from its exercise names. Empty for the many
  /// documents that carry no annotation layer.
  links: PdfLink[];
};

/// Loads pdf.js only when an import actually starts. It is a large dependency and no other part
/// of this app needs it.
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  // The worker is bundled with the app rather than fetched from a CDN: this is an installable PWA
  // and must keep working without a third-party origin.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

/// Extracts every page's text and reports progress as it goes. Pages without a text layer are
/// retained as empty coverage; a page that fails to parse is reported as an actionable error.
/// Cancellation destroys the active loading task or document.
export async function extractPdfText(
  file: File,
  onProgress?: (page: number, pageCount: number) => void,
  signal?: AbortSignal
): Promise<PdfExtraction> {
  assertNotAborted(signal);
  const pdfjs = await loadPdfJs();
  assertNotAborted(signal);
  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) throw cancelledError();
    throw actionablePdfError(error) ?? new PdfTextError('The browser could not read this PDF. Re-save or export it, then try again.');
  }
  assertNotAborted(signal);
  // Nothing here renders the document, so the parts of pdf.js that exist for display stay off.
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false });
  let document: Awaited<typeof loadingTask.promise> | undefined;
  let destruction: Promise<void> | undefined;
  const destroyActivePdf = async () => {
    try {
      destruction ??= (document ? document.destroy() : loadingTask.destroy());
      await destruction;
    } catch {
      // Destruction failures on aborted or destroyed pdf tasks should not mask cancellation.
    }
  };
  const reconstructor = new PdfPageReconstructor();
  const onAbort = () => { reconstructor.dispose(); void destroyActivePdf(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    try {
      document = await loadingTask.promise;
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      throw actionablePdfError(error) ?? new PdfTextError('This PDF could not be opened. Re-save or export it as a PDF, then try again.');
    }
    assertNotAborted(signal);
    const pageCount = document.numPages;
    if (pageCount > MAX_PDF_PAGES) {
      throw new PdfTextError(`That PDF has ${pageCount} pages; the importer accepts up to ${MAX_PDF_PAGES}.`);
    }
    const pages: PdfPageText[] = [];
    const links: PdfLink[] = [];
    let total = 0;
    const readPage = async (number: number): Promise<{ page: number; text: string; links: PdfLink[] }> => {
      assertNotAborted(signal);
      try {
        const page = await document!.getPage(number);
        try {
          const content = await page.getTextContent();
          // Marked-content entries carry no text of their own and are dropped here.
          const pieces = content.items.flatMap(item =>
            'str' in item ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }] : []);
          const text = await reconstructor.build(pieces);
          const annotations = links.length < MAX_PDF_LINKS ? await readPageLinks(page, number, pieces) : [];
          return { page: number, text, links: preferredPageLinks(annotations, printedLinks(number, text)) };
        } finally { page.cleanup(); }
      } catch (error) {
        if (signal?.aborted) throw cancelledError();
        const actionable = actionablePdfError(error);
        if (actionable) throw actionable;
        throw new PdfTextError(`Page ${number} could not be read. Re-save or export the PDF, then try again.`);
      }
    };

    const batchSize = pdfPageBatchSize();
    for (let first = 1; first <= pageCount; first += batchSize) {
      assertNotAborted(signal);
      const numbers = Array.from({ length: Math.min(batchSize, pageCount - first + 1) }, (_, index) => first + index);
      // Wait for both pages to settle before destroying the document on an error or cancellation.
      // Apply results in page order so link selection, limits, and progress stay deterministic.
      const settled = await Promise.allSettled(numbers.map(readPage));
      const failure = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
      if (failure) throw failure.reason;
      for (const item of settled as PromiseFulfilledResult<{ page: number; text: string; links: PdfLink[] }>[]) {
        assertNotAborted(signal);
        const result = item.value;
        if (result.text.length > MAX_PAGE_CHARS) {
          throw new PdfTextError(`PDF page ${result.page} contains more than ${MAX_PAGE_CHARS.toLocaleString()} selectable text characters. Split the PDF into smaller files and retry.`);
        }
        total += result.text.length;
        if (total > MAX_TOTAL_CHARS) {
          throw new PdfTextError('That PDF holds more text than the importer supports. Split it into smaller files.');
        }
        if (result.text.length > 0) pages.push({ page: result.page, text: result.text });
        links.push(...result.links.slice(0, Math.max(0, MAX_PDF_LINKS - links.length)));
        onProgress?.(result.page, pageCount);
      }
    }
    assertNotAborted(signal);
    if (pages.length === 0) {
      throw new PdfTextError('No selectable text was found in that PDF. A scanned document has to be re-saved as a text PDF before it can be imported.');
    }
    return { fileName: file.name, pageCount, pages, pagesWithText: pages.length, links: links.slice(0, MAX_PDF_LINKS) };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reconstructor.dispose();
    await destroyActivePdf();
  }
}

/// Demonstration links are a best-effort extra. A document that carries no annotation layer, or
/// refuses to hand one over, still imports exactly as before — it simply has no videos to offer.
async function readPageLinks(
  page: { getAnnotations: (options: { intent: string }) => Promise<unknown[]> },
  number: number,
  pieces: readonly TextPiece[]
): Promise<PdfLink[]> {
  try {
    const annotations = await page.getAnnotations({ intent: 'display' });
    const rects = annotations.flatMap(item => {
      const link = item as { subtype?: string; url?: unknown; rect?: unknown };
      return link.subtype === 'Link' && typeof link.url === 'string'
        && Array.isArray(link.rect) && link.rect.length === 4 && link.rect.every(value => typeof value === 'number')
        ? [{ url: link.url, rect: link.rect as LinkRect['rect'] }]
        : [];
    });
    return pageLinks(number, pieces, rects);
  } catch {
    return [];
  }
}

/// A failure the person can act on, as opposed to a bug. It carries the sentence shown to them.
export class PdfTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTextError';
  }
}

function cancelledError(): PdfTextError {
  return new PdfTextError('PDF import cancelled.');
}

function actionablePdfError(error: unknown): PdfTextError | undefined {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const details = `${name} ${message}`.toLowerCase();
  if (details.includes('password')) {
    return new PdfTextError('This PDF is password-protected. Remove the password or export an unlocked copy, then try again.');
  }
  if (details.includes('invalidpdf') || details.includes('invalid pdf') || details.includes('formaterror') || details.includes('xref')) {
    return new PdfTextError('This file could not be read as a valid PDF. Re-save or export it as a PDF, then try again.');
  }
  if (name === 'RangeError' || /out of memory|memory|allocation|too complex|maximum call stack/.test(details)) {
    return new PdfTextError('The browser ran out of room while reading this PDF. Close other tabs or try a lighter selectable-text copy.');
  }
  return undefined;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}
