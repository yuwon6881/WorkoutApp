import {
  associateDayLabels, besideTable, dayLabelLine, findDayTitles, findStackedLabels, labelPieces, placeStackedLabels,
  type DayLabel, type TableSpan
} from './pdfDayLabels';
import { findHeaderBands, renderRow, type HeaderBand } from './pdfHeaderColumns';
import { anchorColumn, anchorsRow, renderHeaderTable } from './pdfTableRows';
import {
  estimateFallbackColumnGap, estimateTableRegionGap, groupRows, normalizedText, pieceCenter,
  positionPieces, ROW_TOLERANCE, type PositionedPiece, type TextPiece, type TextRow
} from './pdfGeometry';
import { findTrackingTables, isInTrackingTable, renderTrackingTables, type TrackingTable } from './pdfTrackingTable';
import { MAX_PDF_LINKS, pageLinks, printedLinks, type LinkRect, type PdfLink } from './pdfLinks';

/// Mirrors the server's bounds in `ImportSourceText`, so a document the browser accepts is a
/// document the API accepts.
export const MAX_PDF_PAGES = 1000;
const MAX_PAGE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 2_000_000;

export type PdfPageText = { page: number; text: string };
export type PdfExtraction = {
  fileName: string; pageCount: number; pages: PdfPageText[]; pagesWithText: number;
  /// Demonstration videos the document links from its exercise names. Empty for the many
  /// documents that carry no annotation layer.
  links: PdfLink[];
};

function isScheduleLabel(value: string): boolean {
  return /^(?:BLOCK\s+\d+(?:\s*:\s*.*)?|\(BLOCK\s+\d+\)|WEEK\s+\d+[A-Z]?|INTRO\s+WEEK|DELOAD\s+WEEK|(?:\d(?:\s*[-–]\s*\d)?\s+)?(?:SUGGESTED\s+|MANDATORY\s+|OPTIONAL\s+)?REST\s+DAYS?)$/i.test(normalizedText(value));
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
  const anchor = anchorColumn(band);
  // Padded tables leave more space between two rows than between a cell's wrapped lines, so a
  // wide gap ends the table only when the lines after it hold no further set count. A footer or
  // a note below the table carries none and stays out.
  const nextClusterAnchors = (start: number): boolean => {
    if (anchor === undefined) return false;
    for (let index = start; index < laterRows.length; index++) {
      if (index > start && laterRows[index - 1].y - laterRows[index].y > tableRegionGap) return false;
      if (anchorsRow(laterRows[index], band, anchor)) return true;
    }
    return false;
  };
  const wideGap = Math.max(tableRegionGap * 3, 80);
  let first = true;
  for (let index = 0; index < laterRows.length; index++) {
    const gap = previousY - laterRows[index].y;
    const allowedGap = first ? wideGap : tableRegionGap;
    if (gap > allowedGap && !(gap <= wideGap && nextClusterAnchors(index))) break;
    bottom = laterRows[index].y;
    previousY = bottom;
    first = false;
  }
  return { top: band.topY, bottom, left: band.centers[0], right: band.centers.at(-1) };
}

function scheduleLines(rows: TextRow[]): { y: number; x: number; text: string }[] {
  return rows.flatMap(row => row.items.filter(item => isScheduleLabel(item.str))
    .map(item => ({ y: item.y, x: item.x, text: normalizedText(item.str) })));
}

/// Some tables print the day's title where the name column's label belongs ("PUSH #2 | SETS |
/// REPS"). The title is read as the day's label, but its column still holds the movement names:
/// without it every name fused with its set count ("CLOSE-GRIP BENCH PRESS 3 | 8").
function withTitleColumn(band: HeaderBand, removed: Set<TextPiece>): HeaderBand {
  const first = band.centers[0];
  if (first === undefined || band.columns?.some(column => /^(?:exercises?|movement|(?:exercise )?name)$/i.test(column.label.trim()))) return band;
  const title = [...removed].map(piece => piece as PositionedPiece).find(piece => !piece.rotated
    && piece.endX !== undefined && band.skipYValues.some(y => Math.abs(piece.y - y) <= ROW_TOLERANCE) && piece.endX < first);
  if (!title) return band;
  const center = pieceCenter(title);
  return {
    ...band,
    centers: [center, ...band.centers],
    columns: [{ label: 'Exercise', center }, ...(band.columns ?? [])],
    text: `Exercise | ${band.text}`
  };
}

type TableLayout = {
  genericRows: TextRow[];
  headerTableSpans: { band: HeaderBand; span: TableSpan }[];
  tableSpans: TableSpan[];
};

/// Where a page's tables are once its day titles and schedule banners are set aside.
function tableLayout(rows: TextRow[], trackingTables: TrackingTable[], removed: Set<TextPiece>, fallbackGap: number): TableLayout {
  const genericRows = withoutLabels(rows, removed).filter(row => !trackingTables.some(table => isInTrackingTable(row, table)));
  const headerBands = findHeaderBands(genericRows, fallbackGap / 2.35).map(band => withTitleColumn(band, removed));
  const tableRegionGap = estimateTableRegionGap(genericRows);
  const headerTableSpans = headerBands.map((band, index) => ({
    band,
    span: tableSpanForHeader(genericRows, band, tableRegionGap, headerBands[index + 1]?.topY)
  }));
  const tableSpans = [
    ...trackingTables.map(tableSpanForTracking),
    ...headerTableSpans.map(item => item.span)
  ];
  return { genericRows, headerTableSpans, tableSpans };
}

/// Rebuilds page text in reading order. Geometry, header bands, day labels, and the strict
/// tracking-table family each own a focused pass so their heuristics stay independently testable.
export function buildPageText(items: readonly TextPiece[]): string {
  const positioned = positionPieces(items);
  const rows = groupRows(positioned);
  const fallbackGap = estimateFallbackColumnGap(rows);
  const trackingTables = findTrackingTables(rows);
  const { labels: markedDayLabels, superseded } = findDayTitles(positioned);
  const schedulePieces = new Set<TextPiece>([...superseded, ...rows.flatMap(r => r.items.filter(item => isScheduleLabel(item.str)))]);
  const layoutWithout = (labels: DayLabel[]) => tableLayout(rows, trackingTables,
    new Set([...labelPieces(labels) as Set<TextPiece>, ...schedulePieces]), fallbackGap);
  // A stacked margin title is only a title beside a table, and a table is only found once the
  // stack's words are out of its rows, so the stacks are tried first and kept where they fit. A
  // stack may start with a word the vocabulary already marked ("FULL BODY" over "5 (PUMP DAY)"),
  // so only rotated titles are off limits to it.
  const rotatedTitles = markedDayLabels.filter(label => label.pieces.some(piece => piece.rotated));
  const stacked = findStackedLabels(positioned, labelPieces(rotatedTitles));
  const withStacks = (stacks: DayLabel[]) => {
    const stackPieces = labelPieces(stacks);
    return [...markedDayLabels.filter(label => !label.pieces.some(piece => stackPieces.has(piece))), ...stacks];
  };
  let layout = layoutWithout(withStacks(stacked));
  const stackedTitles = stacked.filter(label => besideTable(label, layout.tableSpans));
  if (stackedTitles.length < stacked.length) layout = layoutWithout(withStacks(stackedTitles));
  const { genericRows, headerTableSpans, tableSpans } = layout;
  const stackPieces = labelPieces(stackedTitles);
  const dayLabels = [
    ...associateDayLabels(markedDayLabels.filter(label => !label.pieces.some(piece => stackPieces.has(piece))), tableSpans),
    ...placeStackedLabels(stackedTitles, tableSpans)
  ];
  const lines: { y: number; x: number; text: string }[] = [
    ...scheduleLines(rows),
    ...dayLabels.map(label => ({ y: label.y, x: label.x, text: dayLabelLine(label) })),
    // A rotated day tab beside a tracking table is its title, not the first word of a movement
    // ("Upper 1 Pull-Up (Wide Grip)").
    ...renderTrackingTables(withoutLabels(rows, new Set([...labelPieces(dayLabels) as Set<TextPiece>, ...schedulePieces])), trackingTables)
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

  // A vertical block badge may print BLOCK above its number, with a program title between them.
  // Preserve the paired heading so the outline can distinguish successive page templates.
  for (const heading of lines.filter(line => line.text === 'BLOCK')) {
    const number = lines.find(line => /^[1-9]$/.test(line.text)
      && line.y < heading.y - 20 && line.y > heading.y - 80
      && line.x >= heading.x && line.x < heading.x + 100);
    if (number) {
      heading.text = `BLOCK ${number.text}`;
      lines.splice(lines.indexOf(number), 1);
    }
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
    const links: PdfLink[] = [];
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
          const pieces = content.items.flatMap(item =>
            'str' in item ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }] : []);
          text = buildPageText(pieces);
          if (links.length < MAX_PDF_LINKS) links.push(...await readPageLinks(page, number, pieces));
          if (links.length < MAX_PDF_LINKS) links.push(...printedLinks(number, text));
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
    return { fileName: file.name, pageCount, pages, pagesWithText: pages.length, links: links.slice(0, MAX_PDF_LINKS) };
  } finally {
    signal?.removeEventListener('abort', onAbort);
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
