/// Shared geometry needed to reconstruct PDF table headers. `pdfText.ts` owns the PDF.js
/// extraction and positioning; these shapes keep this pure header pass usable independently.
import { fontSize, median, type HeaderColumns, type PositionedPiece, type TextRow } from './pdfGeometry';

export type HeaderColumn = { label: string; center: number };

export type HeaderBand = {
  topY: number;
  bottomY: number;
  skipYValues: number[];
  centers: number[];
  text: string;
  columns?: HeaderColumn[];
};

const HEADER_BAND_GAP_FACTOR = 1.6;
const MAX_HEADER_PIECE_LENGTH = 48;

const HEADER_LABELS = [
  /^exercise(?:s)?$/i,
  /^(?:exercise )?name$/i,
  /^warm[ -]?ups?(?: sets?)?$/i,
  /^working(?: sets?)?$/i,
  // High Frequency Full Body heads its count columns "# OF WARMUP / SETS" and "# OF WORKING / SETS".
  /^# of (?:warm[ -]?up|working)(?: sets?)?$/i,
  /^sets?$/i,
  /^(?:reps?|repetitions?)$/i,
  /^reps?\s*\/\s*(?:duration|time)$/i,
  /^early set rpe$/i,
  /^last set rpe$/i,
  /^(?:rpe|ape)(?:\s*\/\s*%?1rm)?$/i,
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

/// Separate header rows can split compound labels vertically ("WORKING" / "SETS") or expand a
/// parent cell into numbered children ("Substitution" / "Option 1"). A nearby section title or
/// compact data row must not join that band just because its text is short.
function isHeaderFragment(value: string): boolean {
  return /^(?:working|early set|last set|warm[ -]?up|set\s*\d+|option\s*\d+|last set technique)$/i.test(value.trim());
}

function isHeaderCandidate(row: TextRow, typicalWordGap: number): boolean {
  // Group headings can be spaced far enough apart that the adaptive cell splitter keeps
  // several of them together. Inspect raw PDF runs as well so compound multi-row headers
  // such as "Last-Set Intensity | Warm-up | Working" remain part of one header band.
  return row.items.some(item => isHeaderLabel(item.str) || isHeaderFragment(item.str))
    || splitHeaderCells(row, rowWordGap(row, typicalWordGap))
      .map(groupLabel)
      .some(label => isHeaderLabel(label) || isHeaderFragment(label));
}

function joinsOneHeaderLabel(left: string, right: string): boolean {
  const joined = `${left.trim()} ${right.trim()}`.replace(/\s+/g, ' ');
  return /^(?:warm[ -]?up|working|early set|last set|set \d+|%?1rm|rest|last set technique)\s+(?:sets?|rpe|rir|techniques?|time)$/i.test(joined)
    || /^(?:early|last|warm|working|set|set \d+)$/i.test(joined);
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

function groupLabel(group: PositionedPiece[]): string {
  return group.map(item => item.str.trim()).filter(Boolean).join(' ');
}

function groupBounds(group: PositionedPiece[]): { left: number; right: number; center: number } {
  const left = Math.min(...group.map(item => item.x));
  const right = Math.max(...group.map(item => item.endX));
  return { left, right, center: (left + right) / 2 };
}

function isHeaderSet(labels: string[]): boolean {
  const matched = labels.filter(isHeaderLabel);
  const prescriptionLabels = matched.filter(label => !/^(?:exercise(?:s)?|name)$/i.test(label));
  return matched.length >= 3 && prescriptionLabels.length >= 2;
}

function rowWordGap(row: TextRow, typicalWordGap: number): number {
  return Math.max(1, median(row.items.map(fontSize)) * 0.32, typicalWordGap * 1.35);
}

function rowTextSize(row: TextRow): number {
  return median(row.items.map(fontSize));
}

type HeaderCellGroup = {
  rowIndex: number;
  y: number;
  left: number;
  right: number;
  center: number;
  label: string;
};

function overlapping(left: Pick<HeaderCellGroup, 'left' | 'right'>, right: Pick<HeaderCellGroup, 'left' | 'right'>): boolean {
  return Math.min(left.right, right.right) >= Math.max(left.left, right.left);
}

function mergeOverlappingCells(groups: HeaderCellGroup[]): HeaderCellGroup[][] {
  const lastRow = Math.max(...groups.map(group => group.rowIndex));
  const cells = groups.filter(group => group.rowIndex === lastRow).map(group => [group]);
  const bounds = (cell: HeaderCellGroup[]) => {
    const leafRow = Math.max(...cell.map(group => group.rowIndex));
    const leaves = cell.filter(group => group.rowIndex === leafRow);
    return { left: Math.min(...leaves.map(group => group.left)), right: Math.max(...leaves.map(group => group.right)) };
  };

  for (let rowIndex = lastRow - 1; rowIndex >= 0; rowIndex--) {
    for (const parent of groups.filter(group => group.rowIndex === rowIndex)) {
      const children = cells.filter(cell => overlapping(parent, bounds(cell)));
      if (children.length === 0) cells.push([parent]);
      else for (const child of children) child.push(parent);
    }
  }
  return cells;
}

function composeCell(groups: HeaderCellGroup[]): { label: string; center: number } {
  const ordered = [...groups].sort((left, right) => left.rowIndex - right.rowIndex || left.left - right.left);
  const labels = ordered.map(group => group.label.trim()).filter(Boolean)
    .filter((label, index, all) => all.findIndex(item => item.toLowerCase() === label.toLowerCase()) === index);
  const leafRow = Math.max(...groups.map(group => group.rowIndex));
  const leaves = groups.filter(group => group.rowIndex === leafRow);
  const left = Math.min(...leaves.map(group => group.left));
  const right = Math.max(...leaves.map(group => group.right));
  return { label: labels.join(' '), center: (left + right) / 2 };
}

/// Finds single- or multi-baseline table headers. Baselines join only when their distance is
/// within 1.6 typical text sizes; the larger gap before the first data row therefore stays out.
export function findHeaderBands(rows: TextRow[], typicalWordGap: number): HeaderBand[] {
  if (rows.length === 0) return [];
  const orderedRows = [...rows].sort((left, right) => right.y - left.y);
  const rowBands: TextRow[][] = [];
  for (const row of orderedRows) {
    const previousBand = rowBands.at(-1);
    const previousRow = previousBand?.at(-1);
    const size = previousRow ? median([rowTextSize(previousRow), rowTextSize(row)]) : 0;
    // A header states labels. Nearby section titles and compact data rows can be just as short,
    // so only adjoining baselines that each contain header labels or fragments join a band.
    const labelsOnly = (candidate: TextRow) => candidate.items.every(item => item.str.trim().length <= MAX_HEADER_PIECE_LENGTH);
    if (previousRow && previousRow.y - row.y <= size * HEADER_BAND_GAP_FACTOR
      && labelsOnly(previousRow) && labelsOnly(row)
      && isHeaderCandidate(previousRow, typicalWordGap) && isHeaderCandidate(row, typicalWordGap)) {
      previousBand!.push(row);
    } else {
      rowBands.push([row]);
    }
  }

  const output: HeaderBand[] = [];
  for (const bandRows of rowBands) {
    const rowGroups = bandRows.map(row => splitHeaderCells(row, rowWordGap(row, typicalWordGap)));
    const groups = rowGroups.flatMap((cells, rowIndex) => cells.map(cell => {
      const bounds = groupBounds(cell);
      return { rowIndex, y: bandRows[rowIndex].y, ...bounds, label: groupLabel(cell) };
    }));
    const cells = mergeOverlappingCells(groups).map(composeCell).sort((left, right) => left.center - right.center);
    const labels = cells.map(cell => cell.label);
    if (!isHeaderSet(labels)) continue;

    const centers = cells.map(cell => cell.center);
    const skipYValues = bandRows.map(row => row.y);
    const topY = Math.max(...skipYValues);
    const bottomY = Math.min(...skipYValues);
    const text = bandRows.length === 1
      ? renderRow(bandRows[0], { centers }, typicalWordGap * 2.35)
      : labels.join(' | ');
    output.push({ topY, bottomY, skipYValues, centers, text, columns: cells });
  }
  return output.sort((left, right) => right.topY - left.topY);
}

/// Renders a baseline using the original gap and column-boundary rules. Keep this logic in sync
/// with the former implementation in `pdfText.ts`: callers rely on its exact separators and
/// spacing for both ordinary text and single-row table headers.
export function renderRow(row: TextRow, columns: HeaderColumns | undefined, fallbackGap: number): string {
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
