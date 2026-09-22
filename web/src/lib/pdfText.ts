import { associateDayLabels, dayLabelLine, findDayLabels, labelPieces, type TableSpan } from './pdfDayLabels';
import { findHeaderBands, renderRow, type HeaderBand } from './pdfHeaderColumns';
import {
  columnIndex, estimateFallbackColumnGap, estimateTableRegionGap, groupRows, normalizedText, pieceCenter,
  positionPieces, ROW_TOLERANCE, type PositionedPiece, type TextPiece, type TextRow
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

function tableSpanForHeader(rows: TextRow[], band: HeaderBand, tableRegionGap: number, nextBandTop?: number): TableSpan {
  let bottom = band.bottomY;
  let previousY = band.bottomY;
  const laterRows = rows.filter(row => row.y < band.bottomY && (nextBandTop === undefined || row.y > nextBandTop))
    .sort((a, b) => b.y - a.y);
  let first = true;
  for (const row of laterRows) {
    const allowedGap = first ? Math.max(tableRegionGap * 3, 80) : tableRegionGap;
    if (previousY - row.y > allowedGap) break;
    bottom = row.y;
    previousY = row.y;
    first = false;
  }
  return { top: band.topY, bottom, left: band.centers[0], right: band.centers.at(-1) };
}

function scheduleLines(rows: TextRow[]): { y: number; x: number; text: string }[] {
  return rows.flatMap(row => row.items.filter(item => isScheduleLabel(item.str))
    .map(item => ({ y: item.y, x: item.x, text: normalizedText(item.str) })));
}

function renderCellPieces(pieces: PositionedPiece[]): string {
  let line = '';
  let endX = Number.NaN;
  let lastY = Number.NaN;
  for (const item of pieces) {
    const gap = Number.isNaN(endX) ? 0 : item.x - endX;
    const isNewLine = !Number.isNaN(lastY) && Math.abs(lastY - item.y) > ROW_TOLERANCE;
    const touching = line.length === 0 || /\s$/.test(line) || /^\s/.test(item.str);
    const continuesWord = !isNewLine && gap > 0 && gap <= 0.5;
    if (isNewLine) {
      if (!touching) line += ' ';
    } else if (!touching && !continuesWord) {
      line += ' ';
    }
    line += item.str;
    endX = item.endX;
    lastY = item.y;
  }
  return line.replace(/[ \t]+/g, ' ').trim();
}

function renderHeaderTable(
  band: HeaderBand,
  tableRows: TextRow[],
  bottom: number,
  fallbackGap: number
): { y: number; x: number; text: string }[] {
  if (tableRows.length === 0) return [];

  let anchorColIndex = -1;
  if (band.columns) {
    anchorColIndex = band.columns.findIndex(c => /^working(?: sets?)?$/i.test(c.label.trim()) || /^sets?$/i.test(c.label.trim()));
    if (anchorColIndex === -1) {
      anchorColIndex = band.columns.findIndex(c => /^(?:reps?|repetitions?)$/i.test(c.label.trim()));
    }
  }

  const isWorkingAnchorText = (text: string) =>
    /^\d{1,2}(?:[-–+]\d{1,2})?$/.test(text) || /^\d{1,2}$/.test(text) || /^amrap$/i.test(text) || /^n\/a$/i.test(text);

  let anchorBaselines: number[] = [];
  if (anchorColIndex >= 0) {
    const candidatePieces = tableRows.flatMap(r => r.items).filter(item => {
      const c = columnIndex(pieceCenter(item), band.centers);
      return c === anchorColIndex && isWorkingAnchorText(normalizedText(item.str).trim());
    });
    const baselines: number[] = [];
    for (const piece of candidatePieces.sort((a, b) => b.y - a.y)) {
      if (!baselines.some(existing => Math.abs(existing - piece.y) <= ROW_TOLERANCE)) {
        baselines.push(piece.y);
      }
    }
    const filtered: number[] = [];
    for (const y of baselines.sort((a, b) => b - a)) {
      if (filtered.length === 0 || filtered.at(-1)! - y >= 10) {
        filtered.push(y);
      }
    }
    anchorBaselines = filtered;
  }

  if (anchorBaselines.length === 0) {
    return tableRows.map(row => {
      const text = renderRow(row, { centers: band.centers }, fallbackGap);
      return { y: row.y, x: row.items[0]?.x ?? 0, text };
    }).filter(line => line.text.length > 0);
  }

  const rendered: { y: number; x: number; text: string }[] = [];
  const allItems = tableRows.flatMap(r => r.items);
  for (let i = 0; i < anchorBaselines.length; i++) {
    const anchorY = anchorBaselines[i];
    const upper = i === 0 ? band.bottomY : (anchorBaselines[i - 1] + anchorY) / 2;
    const lower = i === anchorBaselines.length - 1 ? bottom - 4 : (anchorY + anchorBaselines[i + 1]) / 2;

    const rowItems = allItems.filter(p => p.y <= upper && p.y > lower);
    rowItems.sort((a, b) => b.y - a.y || a.x - b.x);

    const cells: PositionedPiece[][] = Array.from({ length: band.centers.length }, () => []);
    for (const item of rowItems) {
      const col = columnIndex(pieceCenter(item), band.centers);
      cells[col].push(item);
    }

    const cellTexts = cells.map(cellPieces => {
      if (cellPieces.length === 0) return '';
      cellPieces.sort((a, b) => b.y - a.y || a.x - b.x);
      return renderCellPieces(cellPieces);
    });

    while (cellTexts.length > 0 && cellTexts[cellTexts.length - 1] === '') {
      cellTexts.pop();
    }
    const line = cellTexts.join(' | ');
    if (line.replace(/[|\s]/g, '').length > 0) {
      rendered.push({ y: anchorY, x: 0, text: line });
    }
  }

  return rendered;
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
  const schedulePieces = new Set(rows.flatMap(r => r.items.filter(item => isScheduleLabel(item.str))));
  const rowsWithoutLabelsOrSchedule = withoutLabels(rows, new Set([...labelSources, ...schedulePieces]));
  const genericRows = rowsWithoutLabelsOrSchedule.filter(row => !trackingTables.some(table => isInTrackingTable(row, table)));
  const headerBands = findHeaderBands(genericRows, fallbackGap / 2.35);
  const tableRegionGap = estimateTableRegionGap(genericRows);
  const headerTableSpans = headerBands.map((band, index) => ({
    band,
    span: tableSpanForHeader(genericRows, band, tableRegionGap, headerBands[index + 1]?.topY)
  }));
  const tableSpans = [
    ...trackingTables.map(tableSpanForTracking),
    ...headerTableSpans.map(item => item.span)
  ];
  const dayLabels = associateDayLabels(sourceDayLabels, tableSpans);
  const lines: { y: number; x: number; text: string }[] = [
    ...scheduleLines(rows),
    ...dayLabels.map(label => ({ y: label.y, x: label.x, text: dayLabelLine(label) })),
    ...renderTrackingTables(rows, trackingTables)
  ];

  for (let i = 0; i < headerTableSpans.length; i++) {
    const { band, span } = headerTableSpans[i];
    const nextBand = headerTableSpans[i + 1]?.band;
    lines.push({ y: band.topY, x: band.centers[0] ?? 0, text: band.text });
    const tableRows = genericRows.filter(r => r.y < band.bottomY && r.y >= span.bottom && (!nextBand || r.y > nextBand.topY));
    lines.push(...renderHeaderTable(band, tableRows, span.bottom, fallbackGap));
  }

  const outsideRows = genericRows.filter(row =>
    !headerTableSpans.some(({ band, span }, i) => {
      const nextBand = headerTableSpans[i + 1]?.band;
      const lower = nextBand ? Math.max(span.bottom, nextBand.topY) : span.bottom;
      return row.y <= band.topY && row.y >= lower;
    })
  );
  for (const row of outsideRows) {
    const text = renderRow(row, undefined, fallbackGap);
    if (text) lines.push({ y: row.y, x: row.items[0]?.x ?? 0, text });
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
