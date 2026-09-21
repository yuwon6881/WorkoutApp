import { associateDayLabels, dayLabelLine, findDayLabels, labelPieces, type TableSpan } from './pdfDayLabels';
import { findHeaderBands, renderRow, type HeaderBand } from './pdfHeaderColumns';
import {
  estimateFallbackColumnGap, estimateTableRegionGap, groupRows, normalizedText, positionPieces,
  type HeaderColumns, type TextPiece, type TextRow
} from './pdfGeometry';
import { findTrackingTables, isInTrackingTable, renderTrackingTables, type TrackingTable } from './pdfTrackingTable';

/// Mirrors the server's bounds in `ImportSourceText`, so a document the browser accepts is a
/// document the API accepts.
export const MAX_PDF_PAGES = 1000;
const MAX_PAGE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 2_000_000;

export type PdfPageText = { page: number; text: string };
export type PdfExtraction = { fileName: string; pageCount: number; pages: PdfPageText[]; pagesWithText: number };

function isScheduleLabel(value: string): boolean {
  return /^(?:BLOCK\s+\d+(?:\s*:\s*.*)?|\(BLOCK\s+\d+\)|WEEK\s+\d+|INTRO\s+WEEK|DELOAD\s+WEEK|(?:SUGGESTED\s+|MANDATORY\s+)?REST\s+DAY)$/i.test(normalizedText(value));
}

function withoutLabels(rows: TextRow[], removed: Set<TextPiece>): TextRow[] {
  return rows.map(row => ({ ...row, items: row.items.filter(item => !removed.has(item)) }));
}

function tableSpanForTracking(table: TrackingTable): TableSpan {
  return { top: table.headerTop, bottom: table.bottom, left: table.columns[0]?.center,
    right: table.columns.at(-1)?.center };
}

function tableSpanForHeader(rows: TextRow[], band: HeaderBand, tableRegionGap: number): TableSpan {
  let bottom = band.bottomY;
  let previousY = band.bottomY;
  const laterRows = rows.filter(row => row.y < band.bottomY).sort((a, b) => b.y - a.y);
  for (const row of laterRows) {
    if (previousY - row.y > tableRegionGap) break;
    bottom = row.y;
    previousY = row.y;
  }
  return { top: band.topY, bottom, left: band.centers[0], right: band.centers.at(-1) };
}

function scheduleLines(rows: TextRow[]): { y: number; x: number; text: string }[] {
  return rows.flatMap(row => row.items.filter(item => isScheduleLabel(item.str))
    .map(item => ({ y: item.y, x: item.x, text: normalizedText(item.str) })));
}

/// Rebuilds page text in reading order. Geometry, header bands, day labels, and the strict
/// tracking-table family each own a focused pass so their heuristics stay independently testable.
export function buildPageText(items: readonly TextPiece[]): string {
  const positioned = positionPieces(items);
  const rows = groupRows(positioned);
  const fallbackGap = estimateFallbackColumnGap(rows);
  const trackingTables = findTrackingTables(rows);
  const sourceDayLabels = findDayLabels(positioned);
  const labelSources = labelPieces(sourceDayLabels) as Set<TextPiece>;
  const rowsWithoutLabels = withoutLabels(rows, labelSources);
  const genericRows = rowsWithoutLabels.filter(row => !trackingTables.some(table => isInTrackingTable(row, table)));
  const headerBands = findHeaderBands(genericRows, fallbackGap / 2.35);
  const tableRegionGap = estimateTableRegionGap(genericRows);
  const tableSpans = [
    ...trackingTables.map(tableSpanForTracking),
    ...headerBands.map(band => tableSpanForHeader(genericRows, band, tableRegionGap))
  ];
  const dayLabels = associateDayLabels(sourceDayLabels, tableSpans);
  const lines: { y: number; x: number; text: string }[] = [
    ...scheduleLines(rowsWithoutLabels),
    ...dayLabels.map(label => ({ y: label.y, x: label.x, text: dayLabelLine(label) })),
    ...renderTrackingTables(rowsWithoutLabels, trackingTables)
  ];
  const bandByBaseline = new Map<number, HeaderBand>();
  for (const band of headerBands) {
    for (const y of band.skipYValues) bandByBaseline.set(y, band);
  }
  const topBaselines = new Set(headerBands.map(band => band.topY));
  let activeColumns: HeaderColumns | undefined;
  let previousY: number | undefined;
  const skipSchedule = (row: TextRow): TextRow => ({ ...row, items: row.items.filter(item => !isScheduleLabel(item.str)) });
  for (const sourceRow of genericRows) {
    const row = skipSchedule(sourceRow);
    const band = bandByBaseline.get(row.y);
    if (band) {
      if (topBaselines.has(row.y)) {
        activeColumns = { centers: band.centers };
        lines.push({ y: row.y, x: 0, text: band.text });
      }
      previousY = row.y;
      continue;
    }
    if (activeColumns && previousY !== undefined && previousY - row.y > tableRegionGap) activeColumns = undefined;
    const text = renderRow(row, activeColumns, fallbackGap);
    if (text) lines.push({ y: row.y, x: row.items[0]?.x ?? 0, text });
    previousY = row.y;
  }
  return lines.sort((a, b) => b.y - a.y || a.x - b.x).map(line => line.text).join('\n');
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
  const onAbort = () => { void destroyActivePdf(); };
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
    let total = 0;
    for (let number = 1; number <= pageCount; number++) {
      assertNotAborted(signal);
      onProgress?.(number, pageCount);
      assertNotAborted(signal);
      let text = '';
      try {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          // Marked-content entries carry no text of their own and are dropped here.
          text = buildPageText(content.items.flatMap(item =>
            'str' in item ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }] : []));
        } finally { page.cleanup(); }
      } catch (error) {
        if (signal?.aborted) throw cancelledError();
        const actionable = actionablePdfError(error);
        if (actionable) throw actionable;
        throw new PdfTextError(`Page ${number} could not be read. Re-save or export the PDF, then try again.`);
      }
      if (text.length === 0) continue;
      if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS);
      total += text.length;
      if (total > MAX_TOTAL_CHARS) {
        throw new PdfTextError('That PDF holds more text than the importer supports. Split it into smaller files.');
      }
      pages.push({ page: number, text });
    }
    assertNotAborted(signal);
    if (pages.length === 0) {
      throw new PdfTextError('No selectable text was found in that PDF. A scanned document has to be re-saved as a text PDF before it can be imported.');
    }
    return { fileName: file.name, pageCount, pages, pagesWithText: pages.length };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await destroyActivePdf();
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
