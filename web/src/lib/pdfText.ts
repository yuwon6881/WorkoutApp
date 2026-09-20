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
/// Column boundaries are inferred from table headers where possible, or from page-local spacing.

export type PdfPageText = { page: number; text: string };
export type PdfExtraction = { fileName: string; pageCount: number; pages: PdfPageText[]; pagesWithText: number };

/// The shape this module needs from a pdf.js text item. Marked-content items carry no `str` and
/// are ignored.
type TextPiece = { str: string; transform: number[]; width?: number; height?: number };

type PositionedPiece = TextPiece & { x: number; y: number; endX: number };
type TextRow = { y: number; items: PositionedPiece[] };
type HeaderColumns = { centers: number[] };
type MinMaxColumn = { center: number; label: string };
type MinMaxTable = { columns: MinMaxColumn[]; headerTop: number; headerBottom: number; anchors: TextRow[] };

const HEADER_LABELS = [
  /^exercise(?:s)?$/i,
  /^(?:exercise )?name$/i,
  /^warm[ -]?ups?(?: sets?)?$/i,
  /^working sets?$/i,
  /^sets?$/i,
  /^(?:reps?|repetitions?)$/i,
  /^early set rpe$/i,
  /^last set rpe$/i,
  /^rpe(?:\s*\/\s*%?1rm)?$/i,
  /^rir$/i,
  /^set \d+ rir$/i,
  /^rest(?: time)?$/i,
  /^lsrpe$/i,
  /^%?1rm$/i,
  /^(?:load|weight|intensity)$/i,
  /^(?:duration|time)$/i,
  /^(?:last set )?techniques?$/i,
  /^(?:substitutions?|alternates?)$/i,
  /^(?:tracking|notes?)$/i
];

function isHeaderLabel(value: string): boolean {
  return HEADER_LABELS.some(pattern => pattern.test(value.trim()));
}

function joinsOneHeaderLabel(left: string, right: string): boolean {
  const joined = `${left.trim()} ${right.trim()}`.replace(/\s+/g, ' ');
  return /^(?:warm[ -]?up|working|early set|last set|set \d+|%?1rm|rest|last set technique)\s+(?:sets?|rpe|rir|techniques?|time)$/i.test(joined)
    || /^(?:early|last|warm|working|set|set \d+)$/i.test(joined);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function fontSize(piece: TextPiece): number {
  const [a = 0, b = 0, c = 0, d = 0] = piece.transform;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d), 1);
}

/// A vertical day label should lead the table it labels instead of being sorted by its baseline
/// into the middle of the exercise rows. Rotated table text is normalized the same way.
function positionPiece(piece: TextPiece): PositionedPiece {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = piece.transform;
  const width = piece.width ?? piece.str.length * fontSize(piece) * 0.5;
  if (Math.abs(b) > Math.abs(a) * 2) {
    const farX = e + a * width;
    const farY = f + b * width;
    const x = Math.min(e, farX, e + c);
    const y = Math.max(f, farY, f + d);
    const horizontalWidth = Math.max(piece.height ?? Math.hypot(c, d), fontSize(piece));
    return { ...piece, x, y, endX: x + horizontalWidth, width: horizontalWidth };
  }
  return { ...piece, x: e, y: f, endX: e + width };
}

function buildRows(items: readonly TextPiece[]): TextRow[] {
  const rows = new Map<number, PositionedPiece[]>();
  for (const source of items) {
    if (!source.str || source.str.trim().length === 0) continue;
    const item = positionPiece(source);
    const key = Math.round(item.y / ROW_TOLERANCE) * ROW_TOLERANCE;
    const row = rows.get(key);
    if (row) row.push(item); else rows.set(key, [item]);
  }
  return [...rows.entries()]
    .map(([y, row]) => ({ y, items: row.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y);
}

function splitHeaderCells(row: TextRow, wordGap: number): PositionedPiece[][] {
  const cells: PositionedPiece[][] = [];
  for (const item of row.items) {
    const current = cells.at(-1);
    if (!current) {
      cells.push([item]);
      continue;
    }
    const previous = current.at(-1)!;
    const gap = item.x - previous.endX;
    const leftText = current.map(part => part.str).join(' ');
    const keepComposite = joinsOneHeaderLabel(leftText, item.str);
    const separateLabels = isHeaderLabel(leftText) && isHeaderLabel(item.str);
    if (!keepComposite && (separateLabels || gap > wordGap)) cells.push([item]);
    else current.push(item);
  }
  return cells;
}

function findHeaderColumns(rows: TextRow[], typicalWordGap: number): Map<number, HeaderColumns> {
  const headers = new Map<number, HeaderColumns>();
  for (const row of rows) {
    const wordGap = Math.max(1, median(row.items.map(fontSize)) * 0.32, typicalWordGap * 1.35);
    const groups = splitHeaderCells(row, wordGap);
    const labels = groups.map(group => group.map(item => item.str.trim()).filter(Boolean).join(' '));
    const matched = labels.filter(isHeaderLabel);
    const prescriptionLabels = matched.filter(label => !/^(?:exercise(?:s)?|name)$/i.test(label));
    if (matched.length < 3 || prescriptionLabels.length < 2) continue;
    const centers = groups.map(group => {
      const left = Math.min(...group.map(item => item.x));
      const right = Math.max(...group.map(item => item.endX));
      return (left + right) / 2;
    });
    headers.set(row.y, { centers });
  }
  return headers;
}

function estimateFallbackColumnGap(rows: TextRow[]): number {
  const gaps = rows.flatMap(row => row.items.slice(1).map((item, index) => item.x - row.items[index].endX))
    .filter(gap => gap > 0.5);
  // The lower part of the gap distribution estimates ordinary word spacing better than its
  // median because most training-table rows contain more cell boundaries than words.
  const lowerGaps = [...gaps].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(gaps.length * 0.6)));
  const pieces = rows.flatMap(row => row.items);
  const typicalFont = median(pieces.map(fontSize));
  const typicalCharacterWidth = median(pieces.map(item => item.width ? item.width / Math.max(1, item.str.length) : 0));
  // A page with only table rows has no sample of ordinary word spacing; cap the estimate using
  // its font metrics so large column gaps cannot inflate the threshold past themselves.
  const typicalWordGap = Math.min(median(lowerGaps), Math.max(typicalCharacterWidth * 1.4, typicalFont * 0.8));
  return Math.max(3, typicalFont * 0.55, typicalCharacterWidth * 2.2, typicalWordGap * 2.35);
}

function estimateTableRegionGap(rows: TextRow[]): number {
  const rowGaps = rows.slice(1).map((row, index) => rows[index].y - row.y).filter(gap => gap > 0);
  const lowerRowGaps = [...rowGaps].sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(rowGaps.length * 0.5)));
  const typicalFont = median(rows.flatMap(row => row.items.map(fontSize)));
  const typicalRowGap = median(lowerRowGaps);
  return Math.max(ROW_TOLERANCE * 4, typicalFont * 3.5, typicalRowGap * 2.5);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pieceCenter(item: PositionedPiece): number {
  return (item.x + item.endX) / 2;
}

function findMinMaxTable(rows: TextRow[]): MinMaxTable | undefined {
  const items = rows.flatMap(row => row.items);
  for (const parent of items.filter(item => /^tracking load and reps$/i.test(normalizedText(item.str)))) {
    // Min-Max places the tracking banner above a three-line prescription header. Requiring its
    // complete signature keeps this specialized reconstruction away from the other table families.
    const band = items.filter(item => item.y <= parent.y + 8 && item.y >= parent.y - 70);
    const text = band.map(item => normalizedText(item.str));
    const exact = (value: string) => band.filter(item => normalizedText(item.str).toLowerCase() === value.toLowerCase());
    const exercise = exact('Exercise')[0];
    const technique = exact('Technique')[0];
    const lastSet = band.find(item => /^last-set intensity$/i.test(normalizedText(item.str)));
    const warmup = exact('Warm-up')[0];
    const working = exact('WORKING')[0];
    const rep = exact('Rep')[0];
    const range = exact('Range')[0];
    const loads = exact('LOAD').sort((a, b) => pieceCenter(a) - pieceCenter(b));
    const trackedReps = exact('REPS').sort((a, b) => pieceCenter(a) - pieceCenter(b));
    const rirs = exact('RIR').sort((a, b) => pieceCenter(a) - pieceCenter(b));
    const rest = exact('Rest')[0];
    const option1 = exact('Option 1')[0];
    const option2 = exact('Option 2')[0];
    const notes = exact('NOTES')[0];
    const setLabels = band.filter(item => /^sets?$/i.test(normalizedText(item.str)));
    const warmupSets = warmup && setLabels.length > 0
      ? [...setLabels].sort((a, b) => Math.abs(pieceCenter(a) - pieceCenter(warmup))
        - Math.abs(pieceCenter(b) - pieceCenter(warmup)))[0]
      : undefined;
    const workingSets = working && setLabels.length > 0
      ? [...setLabels].sort((a, b) => Math.abs(pieceCenter(a) - pieceCenter(working))
        - Math.abs(pieceCenter(b) - pieceCenter(working)))[0]
      : undefined;
    const repRange = range && rep ? { center: (pieceCenter(range) + pieceCenter(rep)) / 2, label: 'Rep Range' } : undefined;
    const trackingLoad1 = loads[0];
    const trackingLoad2 = loads[1];
    const trackingReps1 = trackedReps[0];
    const trackingReps2 = trackedReps[1];
    if (!exercise || !technique || !lastSet || !warmup || !working || !repRange || !warmupSets || !workingSets
      || loads.length !== 2 || trackedReps.length !== 2 || rirs.length !== 2 || !rest || !option1 || !option2 || !notes
      || !text.some(value => /substitution/i.test(value))) continue;

    const columns: MinMaxColumn[] = [
      { center: pieceCenter(exercise), label: 'Exercise' },
      { center: (pieceCenter(lastSet) + pieceCenter(technique)) / 2, label: 'Last-Set Intensity Technique' },
      { center: (pieceCenter(warmup) + pieceCenter(warmupSets)) / 2, label: 'Warm-up Sets' },
      { center: (pieceCenter(working) + pieceCenter(workingSets)) / 2, label: 'Working Sets' },
      repRange,
      { center: pieceCenter(trackingLoad1), label: 'Tracking Load Set 1' },
      { center: pieceCenter(trackingReps1), label: 'Tracking Reps Set 1' },
      { center: pieceCenter(trackingLoad2), label: 'Tracking Load Set 2' },
      { center: pieceCenter(trackingReps2), label: 'Tracking Reps Set 2' },
      { center: pieceCenter(rirs[0]), label: 'RIR Set 1' },
      { center: pieceCenter(rirs[1]), label: 'RIR Set 2' },
      { center: pieceCenter(rest), label: 'Rest' },
      { center: pieceCenter(option1), label: 'Substitution Option 1' },
      { center: pieceCenter(option2), label: 'Substitution Option 2' },
      { center: pieceCenter(notes), label: 'Notes' }
    ].sort((a, b) => a.center - b.center);
    if (columns.some((column, index) => index > 0 && column.center <= columns[index - 1].center)) continue;

    const headerYs = band.map(item => item.y);
    const headerTop = Math.max(...headerYs);
    const headerBottom = Math.min(...headerYs);
    const centers = columns.map(column => column.center);
    const isNumeric = (value: string | undefined) => !!value && /^(?:\d+(?:\.\d+)?|N\/A)$/i.test(normalizedText(value));
    const isRep = (value: string | undefined) => !!value && /^(?:\d+(?:\s*[-–]\s*\d+)?|N\/A)$/i.test(normalizedText(value));
    const hasTextInColumn = (row: TextRow, index: number, match: (value: string | undefined) => boolean) =>
      row.items.some(item => columnIndex(pieceCenter(item), centers) === index && match(item.str));
    const anchors = rows.filter(row => row.y < headerBottom - 10
      && hasTextInColumn(row, 3, value => !!value && /^\d{1,2}$/.test(normalizedText(value)))
      && hasTextInColumn(row, 4, isRep)
      && hasTextInColumn(row, 9, isNumeric)
      && hasTextInColumn(row, 10, isNumeric)
      && hasTextInColumn(row, 11, value => !!value && /^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m)$/i.test(normalizedText(value))))
      .sort((a, b) => b.y - a.y);
    if (anchors.length > 0) return { columns, headerTop, headerBottom, anchors };
  }
  return undefined;
}

function columnIndex(center: number, centers: number[]): number {
  let index = 0;
  for (let next = 1; next < centers.length; next++) {
    if (center >= (centers[next - 1] + centers[next]) / 2) index = next;
    else break;
  }
  return index;
}

function minMaxColumnIndex(item: PositionedPiece, centers: number[]): number {
  const index = columnIndex(pieceCenter(item), centers);
  const notesIndex = centers.length - 1;
  const substitution2Index = notesIndex - 1;
  // Min-Max centers its Notes heading far to the right while the long note cell begins directly
  // after substitution 2. Keep those left-aligned paragraphs in Notes even when their width pulls
  // the text midpoint back across the generic center-based boundary.
  if (index === substitution2Index && item.x > centers[substitution2Index] + 50) return notesIndex;
  return index;
}

function isScheduleLabel(value: string): boolean {
  return /^(?:BLOCK\s+\d+|WEEK\s+\d+|INTRO\s+WEEK|DELOAD\s+WEEK|(?:SUGGESTED\s+|MANDATORY\s+)?REST\s+DAY|(?:UPPER|LOWER)\s+\d+|ARMS\s*\/\s*DELTS)$/i.test(normalizedText(value));
}

function renderMinMaxPage(rows: TextRow[], fallbackGap: number, table: MinMaxTable): string {
  const rowGaps = table.anchors.slice(1).map((row, index) => table.anchors[index].y - row.y).filter(gap => gap > 0);
  const typicalRowGap = median(rowGaps);
  const finalRowPadding = Math.max(ROW_TOLERANCE * 4, typicalRowGap > 0 ? typicalRowGap / 2 : 40);
  const tableBottom = table.anchors.at(-1)!.y - finalRowPadding;
  const centers = table.columns.map(column => column.center);
  const rendered: { y: number; x: number; text: string }[] = [];
  const schedule = rows.flatMap(row => row.items)
    .filter(item => isScheduleLabel(item.str))
    .map(item => ({ y: item.y, x: item.x, text: normalizedText(item.str) }));
  rendered.push(...schedule);

  for (const row of rows) {
    const inTable = row.y <= table.headerTop + 4 && row.y >= tableBottom;
    if (inTable || row.items.every(item => isScheduleLabel(item.str))) continue;
    const remaining = row.items.filter(item => !isScheduleLabel(item.str));
    const line = renderRow({ ...row, items: remaining }, undefined, fallbackGap);
    if (line) rendered.push({ y: row.y, x: remaining[0]?.x ?? 0, text: line });
  }

  const header = table.columns.map(column => column.label).join(' | ');
  rendered.push({ y: table.headerTop, x: 0, text: header });
  for (let index = 0; index < table.anchors.length; index++) {
    const anchor = table.anchors[index];
    const upper = index === 0 ? (table.headerBottom + anchor.y) / 2 : (table.anchors[index - 1].y + anchor.y) / 2;
    const lower = index === table.anchors.length - 1 ? anchor.y - finalRowPadding
      : (anchor.y + table.anchors[index + 1].y) / 2;
    const cells = table.columns.map(() => [] as string[]);
    for (const row of rows) {
      if (row.y > upper || row.y < lower) continue;
      for (const item of row.items) {
        if (isScheduleLabel(item.str)) continue;
        cells[minMaxColumnIndex(item, centers)].push(normalizedText(item.str));
      }
    }
    const line = cells.map(cell => cell.join(' ').replace(/\s+/g, ' ').trim()).join(' | ');
    if (line.replace(/[|\s]/g, '')) rendered.push({ y: anchor.y, x: 0, text: line });
  }

  return rendered.sort((a, b) => b.y - a.y || a.x - b.x).map(line => line.text).join('\n');
}

function renderRow(row: TextRow, columns: HeaderColumns | undefined, fallbackGap: number): string {
  let line = '';
  let endX = Number.NaN;
  let previousColumn = -1;
  for (const item of row.items) {
    const gap = Number.isNaN(endX) ? 0 : item.x - endX;
    const touching = line.length === 0 || /\s$/.test(line) || /^\s/.test(item.str);
    const continuesWord = gap > 0 && gap <= 0.5;
    if (columns) {
      const center = item.x + (item.width ?? item.str.length * fontSize(item) * 0.5) / 2;
      let column = 0;
      for (let index = 1; index < columns.centers.length; index++) {
        if (center >= (columns.centers[index - 1] + columns.centers[index]) / 2) column = index;
        else break;
      }
      if (previousColumn >= 0 && column > previousColumn) {
        line = line.trimEnd() + ' | '.repeat(column - previousColumn);
      } else if (!touching && !continuesWord) {
        line += ' ';
      }
      previousColumn = column;
    } else if (gap > fallbackGap) {
      line = line.trimEnd() + ' | ';
    } else if (!touching && !continuesWord) {
      line += ' ';
    }
    line += item.str;
    endX = item.endX;
  }
  return line.replace(/[ \t]+/g, ' ').trim();
}

/// Rebuilds page text in reading order. Header-aligned columns guide table pages; non-table pages
/// use a spacing threshold estimated from that page's fonts and word gaps.
export function buildPageText(items: readonly TextPiece[]): string {
  const rows = buildRows(items);
  const fallbackGap = estimateFallbackColumnGap(rows);
  const minMaxTable = findMinMaxTable(rows);
  if (minMaxTable) return renderMinMaxPage(rows, fallbackGap, minMaxTable);
  const headers = findHeaderColumns(rows, fallbackGap / 2.35);
  const tableRegionGap = estimateTableRegionGap(rows);
  let activeColumns: HeaderColumns | undefined;
  let previousY: number | undefined;
  const lines: string[] = [];
  for (const row of rows) {
    if (activeColumns && previousY !== undefined && previousY - row.y > tableRegionGap) {
      activeColumns = undefined;
    }
    const header = headers.get(row.y);
    if (header) activeColumns = header;
    const line = renderRow(row, header ?? activeColumns, fallbackGap);
    if (line) lines.push(line);
    previousY = row.y;
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
