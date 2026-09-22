import { fontSize, isRotated, median, normalizedText, pieceCenter, type PositionedPiece } from './pdfGeometry';

export type DayLabel = {
  text: string;
  x: number;
  top: number;
  bottom: number;
  y: number;
  pieces: PositionedPiece[];
};

export type TableSpan = { top: number; bottom: number; left?: number; right?: number };

const STRUCTURAL_BANNER = /^(?:WEEK\b|BLOCK\b|INTRO\b|DELOAD\b|REST\s+DAY\b)/i;
const DAY_VOCABULARY = /^(?:(?:DAY\s*\d{1,2}|(?:UPPER|LOWER|PUSH|PULL|LEGS?|ARMS?|CHEST|BACK|FULL\s+BODY)(?:\s+(?:#?\d{1,2}|STRENGTH|HYPERTROPHY|VOLUME|POWER))?|ARMS\s*[&/]\s*(?:DELTS|WEAK\s+POINTS))(?:\s*(?:#\d{1,2}|\([^()]{1,28}\)))?)$/i;
const POSITIONAL_LABEL = /^DAY\s*\d{1,2}$/i;
/// How much larger than the page's body text a margin word must be to count as a title.
const STACKED_LABEL_SCALE = 1.4;
const CHART_AXIS_LABEL = /^(?:TOTAL\s+VOLUME|VOLUME\s*\(|\d+(?:\.\d+)?\s*[x×]\s*\/\s*week)/i;

function usableLabel(value: string): boolean {
  const text = normalizedText(value).replace(/\|/g, '/');
  const words = text.split(/\s+/).filter(Boolean);
  return text.length > 0 && text.length <= 60 && words.length <= 6
    && !STRUCTURAL_BANNER.test(text) && !CHART_AXIS_LABEL.test(text);
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return Math.min(leftEnd, rightEnd) > Math.max(leftStart, rightStart);
}

function hasHorizontalOverlap(candidate: PositionedPiece[], horizontal: PositionedPiece[]): boolean {
  const left = Math.min(...candidate.map(piece => piece.x));
  const right = Math.max(...candidate.map(piece => piece.endX));
  const top = Math.max(...candidate.map(piece => piece.yEnd));
  const bottom = Math.min(...candidate.map(piece => piece.yStart));
  return horizontal.some(piece => overlaps(left, right, piece.x, piece.endX)
    && overlaps(bottom, top, piece.yStart, piece.yEnd));
}

function groupRotatedFragments(pieces: PositionedPiece[]): PositionedPiece[][] {
  const ordered = [...pieces].sort((a, b) => a.x - b.x || a.yStart - b.yStart);
  const groups: PositionedPiece[][] = [];
  for (const piece of ordered) {
    const nearest = groups.at(-1);
    if (!nearest) {
      groups.push([piece]);
      continue;
    }
    const previous = nearest.at(-1)!;
    const sameStrip = Math.abs(piece.x - previous.x) <= Math.max(fontSize(piece), fontSize(previous)) * 1.4;
    const gap = piece.yStart - previous.yEnd;
    const contiguous = gap <= Math.max(fontSize(piece), fontSize(previous)) * 1.6 && gap >= -Math.max(fontSize(piece), fontSize(previous)) * 0.5;
    if (sameStrip && contiguous) nearest.push(piece);
    else groups.push([piece]);
  }
  return groups;
}

function makeLabel(pieces: PositionedPiece[], text: string): DayLabel {
  const normalized = normalizedText(text).replace(/\|/g, '/');
  const top = Math.max(...pieces.map(piece => piece.yEnd));
  const bottom = Math.min(...pieces.map(piece => piece.yStart));
  return { text: normalized, x: Math.min(...pieces.map(piece => piece.x)), top, bottom, y: top, pieces };
}

function findRotatedLabels(pieces: PositionedPiece[]): DayLabel[] {
  const rotated = pieces.filter(isRotated);
  if (rotated.length === 0 || rotated.length / pieces.length >= 0.4) return [];
  const horizontal = pieces.filter(piece => !isRotated(piece));
  const isolated = rotated.filter(piece => usableLabel(piece.str)
    && !hasHorizontalOverlap([piece], horizontal));
  return groupRotatedFragments(isolated).flatMap(group => {
    const text = group.map(piece => piece.str).join(' ');
    return usableLabel(text) ? [makeLabel(group, text)] : [];
  });
}

function findHorizontalLabels(pieces: PositionedPiece[]): DayLabel[] {
  return pieces.filter(piece => !isRotated(piece) && DAY_VOCABULARY.test(normalizedText(piece.str)))
    .filter(piece => usableLabel(piece.str))
    .map(piece => makeLabel([piece], piece.str));
}

/// Some layouts print the day title horizontally in the table's left margin, one word per line
/// and larger than the table text: "FULL / BODY / 1" or "SQUAT / TEST:". No single word is a
/// title, and left in the rows each is rendered into the exercise column beside it, turning
/// "Back Squat" into "BACK SQUAT FULL". These are only candidates: a stack is a title when it
/// sits beside a table, which the page reader decides once it knows where the tables are.
export function findStackedLabels(pieces: PositionedPiece[], claimed: ReadonlySet<PositionedPiece>): DayLabel[] {
  const horizontal = pieces.filter(piece => !isRotated(piece) && !claimed.has(piece));
  if (horizontal.length === 0) return [];
  const bodySize = median(horizontal.map(fontSize));
  const isCandidate = (piece: PositionedPiece) => {
    const text = normalizedText(piece.str);
    return fontSize(piece) >= bodySize * STACKED_LABEL_SCALE && text.length <= 16
      && text.split(' ').length <= 2 && !STRUCTURAL_BANNER.test(text);
  };
  const candidates = horizontal.filter(isCandidate).sort((a, b) => b.yEnd - a.yEnd || a.x - b.x);
  const others = horizontal.filter(piece => !isCandidate(piece));
  const groups: PositionedPiece[][] = [];
  for (const piece of candidates) {
    const group = groups.find(existing => continuesStack(existing.at(-1)!, piece));
    if (group) group.push(piece);
    else groups.push([piece]);
  }
  return groups.filter(group => group.length >= 2 && !hasHorizontalOverlap(group, others)).flatMap(group => {
    const text = group.map(piece => normalizedText(piece.str)).join(' ').replace(/:$/, '');
    return usableLabel(text) ? [makeLabel(group, text)] : [];
  });
}

/// The next word of a stack is directly below the last one and centred on the same strip.
function continuesStack(previous: PositionedPiece, piece: PositionedPiece): boolean {
  const size = Math.max(fontSize(previous), fontSize(piece));
  const centred = Math.abs(pieceCenter(previous) - pieceCenter(piece)) <= size * 1.5;
  const gap = previous.yStart - piece.yEnd;
  return centred && gap >= -size * 0.2 && gap <= size * 0.8;
}

/// Whether a stacked candidate is a table's day title: it overlaps the table vertically and sits
/// to the left of the table's first column.
export function besideTable(label: DayLabel, tables: TableSpan[]): boolean {
  const right = Math.max(...label.pieces.map(piece => piece.endX));
  return tables.some(table => Math.min(label.top, table.top) > Math.max(label.bottom, table.bottom)
    && (table.left === undefined || right < table.left));
}

/// Rotated margin text is the strongest day-title signal. Bare vocabulary is a fallback for
/// layouts that print the title horizontally; week, block, deload, and rest banners stay distinct.
export function findDayLabels(pieces: PositionedPiece[]): DayLabel[] {
  return findDayTitles(pieces).labels;
}

/// The day titles a page marks, plus the margin tabs they were preferred over. A superseded
/// "DAY 1" tab is still a title rather than table text: left in the rows it is read into the
/// exercise beside it ("DAY 1 DUMBBELL WALKING LUNGE").
export function findDayTitles(pieces: PositionedPiece[]): { labels: DayLabel[]; superseded: PositionedPiece[] } {
  const rotated = findRotatedLabels(pieces);
  const labels = preferredLabels(rotated, findHorizontalLabels(pieces));
  const kept = labelPieces(labels);
  const superseded = rotated.flatMap(label => label.pieces).filter(piece => !kept.has(piece));
  return { labels: labels.sort((a, b) => b.y - a.y || a.x - b.x), superseded };
}

/// A rotated tab usually carries the day's own title, but some layouts use it only to count the
/// day and print the session's name as the table header. "Day 3" states the position the draft
/// already knows and would replace "Upper #1" with it, so an equally numerous descriptive header
/// is preferred. Anything less certain keeps the margin text.
function preferredLabels(rotated: DayLabel[], horizontal: DayLabel[]): DayLabel[] {
  if (rotated.length === 0) return horizontal;
  if (!rotated.every(label => POSITIONAL_LABEL.test(normalizedText(label.text)))) return rotated;
  const descriptive = horizontal.filter(label => !POSITIONAL_LABEL.test(normalizedText(label.text)));
  return descriptive.length === rotated.length ? descriptive : rotated;
}

/// Place stacked titles where their days begin. One table can hold several days, each titled by
/// a stack centred on that day's rows, so only a table's first title goes above its header; each
/// later one goes midway between it and the stack above, which is where one day's rows end and
/// the next day's begin.
export function placeStackedLabels(labels: DayLabel[], tables: TableSpan[]): DayLabel[] {
  const ordered = [...labels].sort((a, b) => b.top - a.top);
  const tableOf = (label: DayLabel) => tables.findIndex(table => besideTable(label, [table]));
  return ordered.map((label, index) => {
    const table = tableOf(label);
    const previous = ordered[index - 1];
    if (previous && tableOf(previous) === table) return { ...label, y: (previous.bottom + label.top) / 2 };
    return table >= 0 ? { ...label, y: tables[table].top + 0.01 } : label;
  });
}

/// Place a marked label immediately before its table header. A long sidebar label may overlap
/// several page rows, so choose the table with the greatest overlap and nearest vertical center.
export function associateDayLabels(labels: DayLabel[], tables: TableSpan[]): DayLabel[] {
  if (tables.length === 0) return labels;
  const usedTables = new Set<number>();
  const preferUniqueTables = tables.length >= labels.length;
  return labels.map(label => {
    const ranked = tables.map((table, index) => {
      const overlap = Math.max(0, Math.min(label.top, table.top) - Math.max(label.bottom, table.bottom));
      const tableHeight = Math.max(1, table.top - table.bottom);
      const centerDistance = Math.abs((label.top + label.bottom) / 2 - (table.top + table.bottom) / 2);
      const tableWidth = Math.max(1, (table.right ?? table.left ?? 0) - (table.left ?? table.right ?? 0));
      const labelCenter = label.pieces.length === 0 ? label.x
        : (Math.min(...label.pieces.map(piece => piece.x)) + Math.max(...label.pieces.map(piece => piece.endX))) / 2;
      const horizontalDistance = table.left === undefined || table.right === undefined ? 0
        : labelCenter < table.left ? table.left - labelCenter
          : labelCenter > table.right ? labelCenter - table.right : 0;
      const score = overlap / tableHeight / (1 + horizontalDistance / tableWidth);
      return { table, index, score, centerDistance, horizontalDistance };
    }).sort((a, b) => b.score - a.score || a.horizontalDistance - b.horizontalDistance || a.centerDistance - b.centerDistance);
    const chosen = preferUniqueTables ? ranked.find(candidate => !usedTables.has(candidate.index) && candidate.score > 0)
      ?? ranked.find(candidate => candidate.score > 0) : ranked.find(candidate => candidate.score > 0);
    if (!chosen) return label;
    usedTables.add(chosen.index);
    return { ...label, y: chosen.table.top + 0.01 };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
}

export function dayLabelLine(label: DayLabel): string {
  return `DAY LABEL: ${label.text.replace(/\|/g, '/')}`;
}

export function labelPieces(labels: DayLabel[]): Set<PositionedPiece> {
  return new Set(labels.flatMap(label => label.pieces));
}
