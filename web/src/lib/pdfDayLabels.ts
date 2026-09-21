import { fontSize, isRotated, normalizedText, type PositionedPiece } from './pdfGeometry';

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

/// Rotated margin text is the strongest day-title signal. Bare vocabulary is a fallback for
/// layouts that print the title horizontally; week, block, deload, and rest banners stay distinct.
export function findDayLabels(pieces: PositionedPiece[]): DayLabel[] {
  const rotated = findRotatedLabels(pieces);
  const labels = rotated.length > 0 ? rotated : findHorizontalLabels(pieces);
  return labels.sort((a, b) => b.y - a.y || a.x - b.x);
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
