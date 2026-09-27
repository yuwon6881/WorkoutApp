import type { HeaderBand } from './pdfHeaderColumns';
import { fontSize, median, normalizedText, pieceCenter, ROW_TOLERANCE, type PositionedPiece, type TextPiece, type TextRow } from './pdfGeometry';

function insertColumn(band: HeaderBand, center: number): HeaderBand {
  return {
    ...band,
    centers: [center, ...band.centers],
    columns: [{ label: 'Exercise', center }, ...(band.columns ?? [])],
    text: `Exercise | ${band.text}`
  };
}

/// A title can occupy the name header. Other tables leave that header empty, but their names
/// still sit to the left of printed set counts. Preserve that column rather than folding counts
/// into names, including names that wrap around the count's baseline.
export function withExerciseColumn(band: HeaderBand, rows: TextRow[], removed: Set<TextPiece>, nextBandTop?: number): HeaderBand {
  const first = band.centers[0];
  if (first === undefined || band.columns?.some(column => /^(?:exercises?|movement|(?:exercise )?name)$/i.test(column.label.trim()))) return band;
  const title = [...removed].map(piece => piece as PositionedPiece).find(piece => !piece.rotated
    && piece.endX !== undefined && band.skipYValues.some(y => Math.abs(piece.y - y) <= Math.max(ROW_TOLERANCE, fontSize(piece) * 0.75))
    && piece.endX < first);
  if (title) return insertColumn(band, pieceCenter(title));
  if (!/^(?:working\s+)?sets?$/i.test(band.columns?.[0]?.label.trim() ?? '')) return band;
  const second = band.centers[1];
  if (second === undefined) return band;
  const countRadius = Math.max(4, (second - first) / 3);
  const centers: number[] = [];
  for (const row of rows) {
    if (row.y >= band.bottomY || (nextBandTop !== undefined && row.y <= nextBandTop)) continue;
    const hasCount = row.items.some(item => Math.abs(pieceCenter(item) - first) <= countRadius
      && /^\d{1,2}(?:\s*[-–]\s*\d{1,2})?$/.test(normalizedText(item.str)));
    if (!hasCount) continue;
    for (const item of row.items) {
      const text = normalizedText(item.str);
      if (pieceCenter(item) >= first - countRadius || !/[a-z]{3}/i.test(text)
        || /^(?:total|weekly|session|notes?)\b/i.test(text)) continue;
      centers.push(pieceCenter(item));
    }
  }
  return centers.length > 0 ? insertColumn(band, median(centers)) : band;
}
