import { renderRow, type HeaderBand } from './pdfHeaderColumns';
import {
  columnIndex, fontSize, normalizedText, pieceCenter, ROW_TOLERANCE, type PositionedPiece, type TextRow
} from './pdfGeometry';

/// Rebuilds a header-aligned table's rows. Each row is found by the set count it prints, and
/// every piece around it is placed in the column and row it belongs to.
/// The column each table row anchors on: its working-set count, or its reps where a table prints
/// no set column. Undefined for a header that names neither.
const TABLE_TALLY = /^TOTAL\s+(?:SET\s+VOLUME|TRAINING\s+TIME)\b/i;

export function anchorColumn(band: HeaderBand): number | undefined {
  if (!band.columns) return undefined;
  const sets = band.columns.findIndex(c => /^(?:# of )?working(?: sets?)?$/i.test(c.label.trim()) || /^sets?$/i.test(c.label.trim()));
  if (sets >= 0) return sets;
  const reps = band.columns.findIndex(c => /^(?:reps?|repetitions?)$/i.test(c.label.trim()));
  return reps >= 0 ? reps : undefined;
}

function isWorkingAnchorText(text: string): boolean {
  // "1+" is a working-set count too: a top set followed by as many back-offs as it takes.
  // A count can also be per side ("2 per leg") or a choice ("2 or 3").
  return /^\d{1,2}(?:[-–+]\d{1,2}|\+)?$/.test(text) || /^amrap$/i.test(text) || /^n\/a$/i.test(text)
    || /^\d{1,2}\s+(?:per\s+(?:leg|arm|side)|or\s+\d{1,2})$/i.test(text);
}

export function anchorsRow(row: TextRow, band: HeaderBand, column: number): boolean {
  return row.items.some(item => columnIndex(pieceCenter(item), band.centers) === column
    && isWorkingAnchorText(normalizedText(item.str).trim()));
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
      // A compound wrapped at its hyphen ("Behind-" over "The-Back") is still one word.
      const wrapsAtHyphen = /[\p{L}\p{N}]-$/u.test(line) && /^[\p{L}\p{N}]/u.test(item.str);
      if (!touching && !wrapsAtHyphen) line += ' ';
    } else if (!touching && !continuesWord) {
      line += ' ';
    }
    line += item.str;
    endX = item.endX;
    lastY = item.y;
  }
  return line.replace(/[ \t]+/g, ' ').trim();
}

/// A left-aligned cell's short closing line ("hamstrings.") centers far left of the cell and would
/// fall into the column before it, so it follows the widest line that starts where it starts.
function cellColumn(item: PositionedPiece, rowItems: PositionedPiece[], band: HeaderBand): number {
  const widest = rowItems.filter(other => Math.abs(other.x - item.x) <= 1)
    .reduce((best, other) => other.endX - other.x > best.endX - best.x ? other : best, item);
  return columnIndex(pieceCenter(widest), band.centers);
}

export function renderHeaderTable(
  band: HeaderBand,
  tableRows: TextRow[],
  bottom: number,
  fallbackGap: number
): { y: number; x: number; text: string }[] {
  if (tableRows.length === 0) return [];

  const anchorColIndex = anchorColumn(band) ?? -1;

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
  const last = anchorBaselines.length - 1;
  // The last row has no neighbour below to split against. It reaches down through the lines that
  // continue it at line spacing, so a footer note printed after a gap stays its own line rather
  // than being read into the final exercise ("CURL *NOTE: REST TIMES ARE GIVEN IN | 3 MINUTES.").
  let tableLower = last > 0 ? anchorBaselines[last] - ROW_TOLERANCE : bottom - 4;
  const rowPitch = last > 0 ? (anchorBaselines[0] - anchorBaselines[last]) / last : 0;
  let previous = tableRows.find(row => Math.abs(row.y - anchorBaselines[last]) <= ROW_TOLERANCE);
  for (const row of last > 0 ? [...tableRows].filter(row => row.y < anchorBaselines[last] - ROW_TOLERANCE).sort((a, b) => b.y - a.y) : []) {
    const spacing = Math.max(0.45 * rowPitch, 1.5 * Math.max(...row.items.map(fontSize), ...(previous?.items.map(fontSize) ?? [])));
    if ((previous?.y ?? anchorBaselines[last]) - row.y > spacing) break;
    tableLower = row.y - ROW_TOLERANCE;
    previous = row;
  }
  tableLower = Math.max(tableLower, bottom - 4);
  const bounds = anchorBaselines.map((anchorY, i) => ({
    upper: i === 0 ? band.bottomY : (anchorBaselines[i - 1] + anchorY) / 2,
    lower: i === last ? tableLower : (anchorY + anchorBaselines[i + 1]) / 2
  }));
  // A table's own tally ("TOTAL SET VOLUME: 18") is printed under its last row, not in it.
  const inTable = allItems.filter(item => item.y <= band.bottomY && item.y > tableLower && !TABLE_TALLY.test(item.str.trim()));
  const rowOf = wrappedRows(inTable, anchorBaselines, band);
  for (const item of inTable) {
    if (!rowOf.has(item)) rowOf.set(item, bounds.findIndex(row => item.y <= row.upper && item.y > row.lower));
  }
  const outside = tableRows.map(row => ({ ...row, items: row.items.filter(item => !inTable.includes(item)) }))
    .filter(row => row.items.length > 0 && (row.y <= tableLower || row.items.some(item => TABLE_TALLY.test(item.str.trim()))));
  rendered.push(...outside
    .map(row => ({ y: row.y, x: row.items[0]?.x ?? 0, text: renderRow(row, undefined, fallbackGap) }))
    .filter(line => line.text.length > 0));

  for (let i = 0; i < anchorBaselines.length; i++) {
    const rowItems = inTable.filter(item => rowOf.get(item) === i);
    rowItems.sort((a, b) => b.y - a.y || a.x - b.x);

    const cells: PositionedPiece[][] = Array.from({ length: band.centers.length }, () => []);
    for (const item of rowItems) cells[cellColumn(item, rowItems, band)].push(item);

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
      rendered.push({ y: anchorBaselines[i], x: 0, text: line });
    }
  }

  return rendered;
}

/// A cell wrapped over several lines stays with the row whose set count those lines surround. A
/// top-aligned cell ("ECCENTRIC- / ACCENTUATED STANDING / CALF RAISE") prints its count on its
/// first line, so its last line sits past the midpoint to the next row and would be read into it.
/// A block that spans no count, or two, is left to the midpoint rule.
function wrappedRows(items: PositionedPiece[], anchors: number[], band: HeaderBand): Map<PositionedPiece, number> {
  const byColumn = new Map<number, PositionedPiece[]>();
  for (const item of items) {
    const column = cellColumn(item, items, band);
    byColumn.set(column, [...(byColumn.get(column) ?? []), item]);
  }
  const assigned = new Map<PositionedPiece, number>();
  for (const pieces of byColumn.values()) {
    const ordered = [...pieces].sort((a, b) => b.y - a.y);
    let block: PositionedPiece[] = [];
    const settle = () => {
      if (block.length < 2) return;
      const top = block[0].y + ROW_TOLERANCE;
      const bottom = block.at(-1)!.y - ROW_TOLERANCE;
      const spanned = anchors.flatMap((anchor, index) => anchor <= top && anchor >= bottom ? [index] : []);
      if (spanned.length === 1) {
        for (const piece of block) assigned.set(piece, spanned[0]);
      } else if (spanned.length > 1
        && spanned.every(index => block.some(piece => Math.abs(piece.y - anchors[index]) <= ROW_TOLERANCE))) {
        // Top-aligned cells packed line under line: each starts on its own row's set count.
        for (const piece of block) {
          const owner = spanned.filter(index => anchors[index] >= piece.y - ROW_TOLERANCE).at(-1);
          if (owner !== undefined) assigned.set(piece, owner);
        }
      }
    };
    for (const piece of ordered) {
      const previous = block.at(-1);
      if (previous && previous.y - piece.y > 1.5 * Math.max(fontSize(previous), fontSize(piece))) {
        settle();
        block = [];
      }
      block.push(piece);
    }
    settle();
  }
  return assigned;
}
