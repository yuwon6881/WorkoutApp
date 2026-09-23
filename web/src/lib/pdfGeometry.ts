/// Shared PDF text geometry used by the page reader and the focused table readers.
export type TextPiece = { str: string; transform: number[]; width?: number; height?: number };

export type PositionedPiece = TextPiece & {
  x: number;
  y: number;
  endX: number;
  yStart: number;
  yEnd: number;
  rotated: boolean;
};

export type TextRow = { y: number; items: PositionedPiece[] };
export type HeaderColumns = { centers: number[] };

export const ROW_TOLERANCE = 2.5;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function fontSize(piece: TextPiece): number {
  const [a = 0, b = 0, c = 0, d = 0] = piece.transform;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d), 1);
}

export function textSize(pieces: readonly TextPiece[]): number {
  return median(pieces.map(fontSize));
}

export function isRotated(piece: TextPiece): boolean {
  const [a = 1, b = 0] = piece.transform;
  return Math.abs(b) > Math.abs(a) * 2;
}

/// pdf.js width is already the run's text advance. The matrix supplies its direction, so the
/// rotated span is one run width long regardless of the transform's font scale.
export function positionPiece(piece: TextPiece): PositionedPiece {
  const [, b = 0, c = 0, d = 1, e = 0, f = 0] = piece.transform;
  const width = piece.width ?? piece.str.length * fontSize(piece) * 0.5;
  const rotated = isRotated(piece);
  if (rotated) {
    const horizontalHeight = piece.height ?? (Math.hypot(c, d) || fontSize(piece));
    const verticalEnd = f + Math.sign(b || 1) * width;
    return {
      ...piece,
      x: c < 0 ? e - horizontalHeight : e,
      y: Math.max(f, verticalEnd),
      endX: c < 0 ? e : e + horizontalHeight,
      yStart: Math.min(f, verticalEnd),
      yEnd: Math.max(f, verticalEnd),
      rotated,
      width: horizontalHeight
    };
  }
  const size = fontSize(piece);
  return {
    ...piece,
    x: e,
    y: f,
    endX: e + width,
    yStart: f - size / 2,
    yEnd: f + size / 2,
    rotated
  };
}

export function positionPieces(items: readonly TextPiece[]): PositionedPiece[] {
  // A run can carry its own line break ("Flat DB Press\n"); left in, it splits the table row it
  // belongs to across two lines of the page text.
  const positioned = items.filter(item => item.str.trim().length > 0)
    .map(item => positionPiece(/[\r\n]/.test(item.str) ? { ...item, str: item.str.replace(/[\r\n]+/g, ' ') } : item));
  // Some pages draw every word twice in the same place to fake a bold weight; read once, the
  // copy doubled every name ("DEADLIFT DEADLIFT").
  const seen = new Set<string>();
  return positioned.filter(piece => {
    const key = `${piece.str}\u0000${Math.round(piece.x * 2)}\u0000${Math.round(piece.y * 2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupRows(items: readonly PositionedPiece[]): TextRow[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: PositionedPiece[] }[] = [];
  for (const item of sorted) {
    const existing = rows.find(row => Math.abs(row.y - item.y) <= ROW_TOLERANCE);
    if (existing) {
      existing.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }
  return rows
    .map(row => ({ y: row.y, items: row.items.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y);
}

export function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function pieceCenter(item: PositionedPiece): number {
  return (item.x + item.endX) / 2;
}

export function columnIndex(center: number, centers: number[]): number {
  let index = 0;
  for (let next = 1; next < centers.length; next++) {
    if (center >= (centers[next - 1] + centers[next]) / 2) index = next;
    else break;
  }
  return index;
}

export function estimateFallbackColumnGap(rows: TextRow[]): number {
  const gaps = rows.flatMap(row => row.items.slice(1).map((item, index) => item.x - row.items[index].endX))
    .filter(gap => gap > 0.5);
  const lowerGaps = [...gaps].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(gaps.length * 0.6)));
  const pieces = rows.flatMap(row => row.items);
  const typicalFont = median(pieces.map(fontSize));
  const typicalCharacterWidth = median(pieces.map(item => item.width ? item.width / Math.max(1, item.str.length) : 0));
  const typicalWordGap = Math.min(median(lowerGaps), Math.max(typicalCharacterWidth * 1.4, typicalFont * 0.8));
  return Math.max(3, typicalFont * 0.55, typicalCharacterWidth * 2.2, typicalWordGap * 2.35);
}

export function estimateTableRegionGap(rows: TextRow[]): number {
  const rowGaps = rows.slice(1).map((row, index) => rows[index].y - row.y).filter(gap => gap > 0);
  const lowerRowGaps = [...rowGaps].sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(rowGaps.length * 0.5)));
  const typicalFont = median(rows.flatMap(row => row.items.map(fontSize)));
  const typicalRowGap = median(lowerRowGaps);
  return Math.max(ROW_TOLERANCE * 4, typicalFont * 3.5, typicalRowGap * 2.5);
}
