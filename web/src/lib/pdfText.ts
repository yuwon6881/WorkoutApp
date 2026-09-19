/// Reads a PDF's text layer in the browser. The document never leaves the device: only the text
/// it already contains is sent to the server, which is what makes a 70 MB illustrated training
/// book importable at all. Pages whose content exists only as an image contribute nothing here
/// and are simply absent from the result.

/// Mirrors the server's bounds in `ImportSourceText`, so a document the browser accepts is a
/// document the API accepts.
export const MAX_PDF_PAGES = 1000;
const MAX_PAGE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 2_000_000;
/// Words on the same printed line rarely differ by more than a point or two of baseline. Grouping
/// at this tolerance keeps a training table's rows intact instead of interleaving its columns.
const ROW_TOLERANCE = 2.5;
/// Visible horizontal separation across table columns. Normal word spacing in Latin text is
/// around 3-8 points; anything wider than 20 points is a column break across adjacent table cells.
export const COLUMN_GAP_THRESHOLD = 20;

export type PdfPageText = { page: number; text: string };
export type PdfExtraction = { fileName: string; pageCount: number; pages: PdfPageText[]; pagesWithText: number };

/// The shape this module needs from a pdf.js text item. Marked-content items carry no `str` and
/// are ignored.
type TextPiece = { str: string; transform: number[]; width?: number };

/// Rebuilds one page's lines from the measured position of each piece of text. pdf.js returns
/// items in content-stream order, which for a multi-column or tabular page is not reading order;
/// ordering by baseline and then by horizontal position is.
export function buildPageText(items: readonly TextPiece[]): string {
  const rows = new Map<number, TextPiece[]>();
  for (const item of items) {
    if (!item.str || item.str.trim().length === 0) continue;
    const y = item.transform[5];
    const key = Math.round(y / ROW_TOLERANCE) * ROW_TOLERANCE;
    const row = rows.get(key);
    if (row) row.push(item); else rows.set(key, [item]);
  }
  const lines: string[] = [];
  for (const key of [...rows.keys()].sort((a, b) => b - a)) {
    const row = rows.get(key)!.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = '';
    let end = Number.NaN;
    for (const item of row) {
      const start = item.transform[4];
      // pdf.js emits a table cell as several pieces and does not always include the space between
      // them, so two adjacent pieces are separated unless one of them already carries whitespace.
      // A visible horizontal gap is a column boundary and always separates with an explicit ' | '.
      const gap = Number.isNaN(end) ? 0 : start - end;
      const touching = line.length === 0 || /\s$/.test(line) || /^\s/.test(item.str);
      // A hair's gap is kerning inside one word; anything wider is a space or a column boundary.
      const continuesWord = gap > 0 && gap <= 0.5;
      if (gap >= COLUMN_GAP_THRESHOLD) {
        line = line.trimEnd() + ' | ' + item.str.trimStart();
      } else {
        if (!touching && !continuesWord) line += ' ';
        line += item.str;
      }
      end = start + (item.width ?? 0);
    }
    const trimmed = line.replace(/[ \t]+/g, ' ').trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }
  return lines.join('\n');
}

/// Loads pdf.js only when an import actually starts. It is a large dependency and no other part
/// of this app needs it.
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  // The worker is bundled with the app rather than fetched from a CDN: this is an installable PWA
  // and must keep working without a third-party origin.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

/// Extracts every page's text, reporting progress as it goes. A page that fails to parse is
/// skipped rather than failing the whole document; the review panel reports how many pages
/// actually yielded text.
export async function extractPdfText(file: File, onProgress?: (page: number, pageCount: number) => void): Promise<PdfExtraction> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  // Nothing here renders the document, so the parts of pdf.js that exist for display stay off.
  const document = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const pageCount = document.numPages;
    if (pageCount > MAX_PDF_PAGES) {
      throw new PdfTextError(`That PDF has ${pageCount} pages; the importer accepts up to ${MAX_PDF_PAGES}.`);
    }
    const pages: PdfPageText[] = [];
    let total = 0;
    for (let number = 1; number <= pageCount; number++) {
      onProgress?.(number, pageCount);
      let text = '';
      try {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          // Marked-content entries carry no text of their own and are dropped here.
          text = buildPageText(content.items.flatMap(item =>
            'str' in item ? [{ str: item.str, transform: item.transform, width: item.width }] : []));
        } finally { page.cleanup(); }
      } catch {
        // An unreadable page is treated exactly like a page of photographs: it contributes no
        // text, and the count of pages with text tells the user what was left out.
        text = '';
      }
      if (text.length === 0) continue;
      if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS);
      total += text.length;
      if (total > MAX_TOTAL_CHARS) {
        throw new PdfTextError('That PDF holds more text than the importer supports. Split it into smaller files.');
      }
      pages.push({ page: number, text });
    }
    if (pages.length === 0) {
      throw new PdfTextError('No selectable text was found in that PDF. A scanned document has to be re-saved as a text PDF before it can be imported.');
    }
    return { fileName: file.name, pageCount, pages, pagesWithText: pages.length };
  } finally {
    await document.destroy();
  }
}

/// A failure the person can act on, as opposed to a bug. It carries the sentence shown to them.
export class PdfTextError extends Error {}
