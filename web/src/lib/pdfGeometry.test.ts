import { describe, expect, it } from 'vitest';
import { groupRows, positionPiece, positionPieces } from './pdfGeometry';
import { rotatedPiece } from './pdfPieces.fixtures';

describe('PDF text geometry', () => {
  it('reads a repainted wide final glyph before a space only once', () => {
    const pieces = positionPieces([
      { str: 'LEAN', transform: [8, 0, 0, 8, 496.708, 690.339], width: 20.36146097 },
      { str: 'N I', transform: [8, 0, 0, 8, 511.428, 690.339], width: 9.91907221 },
      { str: 'IN', transform: [8, 0, 0, 8, 519.13, 690.339], width: 7.85646097 }
    ]);
    expect(pieces.map(piece => piece.str)).toEqual(['LEAN IN']);
  });

  it('keeps a repeated letter at a separate printed position or baseline', () => {
    const pieces = positionPieces([
      { str: 'LEAN', transform: [8, 0, 0, 8, 100, 100], width: 20 },
      { str: 'N INTO', transform: [8, 0, 0, 8, 123, 100], width: 25 },
      { str: 'N INTO', transform: [8, 0, 0, 8, 115, 80], width: 25 }
    ]);
    expect(pieces.map(piece => piece.str)).toEqual(['LEAN', 'N INTO', 'N INTO']);
  });
  it('uses the run advance, not a font-scaled matrix value, for a rotated span', () => {
    const positioned = positionPiece(rotatedPiece('Upper 1', 90, 100, 35, 12));
    expect(positioned).toMatchObject({ x: 78, endX: 90, y: 135, yStart: 100, yEnd: 135 });
  });

  it('supports the opposite quarter-turn direction', () => {
    const positioned = positionPiece(rotatedPiece('DAY 1', 90, 100, 25, 12, 'ccw'));
    expect(positioned).toMatchObject({ x: 90, endX: 102, y: 100, yStart: 75, yEnd: 100 });
  });

  it('clusters pieces on near baselines into the same TextRow using proximity grouping', () => {
    const pieces = positionPieces([
      { str: 'Barbell', transform: [10, 0, 0, 10, 100, 501.2], width: 45 },
      { str: 'RDL', transform: [10, 0, 0, 10, 150, 501.3], width: 25 },
      { str: 'Hyperextension', transform: [10, 0, 0, 10, 100, 480], width: 80 }
    ]);
    const rows = groupRows(pieces);
    expect(rows).toHaveLength(2);
    expect(rows[0].items.map(i => i.str)).toEqual(['Barbell', 'RDL']);
    expect(rows[1].items.map(i => i.str)).toEqual(['Hyperextension']);
  });

  it('positions pieces with special characters like degree symbols faithfully', () => {
    const positioned = positionPiece({ str: '45°', transform: [10, 0, 0, 10, 200, 500], width: 20 });
    expect(positioned).toMatchObject({ x: 200, y: 500, endX: 220, rotated: false });
  });

  it('removes overlapping sliding glyph runs without changing adjacent text', () => {
    const pieces = positionPieces([
      { str: 'C', transform: [10, 0, 0, 10, 10, 100], width: 5 },
      { str: 'CA', transform: [10, 0, 0, 10, 10, 100], width: 10 },
      { str: 'AB', transform: [10, 0, 0, 10, 15, 100], width: 10 },
      { str: 'BL', transform: [10, 0, 0, 10, 20, 100], width: 10 },
      { str: 'ROW', transform: [10, 0, 0, 10, 40, 100], width: 18 }
    ]);
    expect(pieces.map(piece => piece.str)).toEqual(['CABL', 'ROW']);
    expect(pieces.map(piece => piece.x)).toEqual([10, 40]);
  });
});
