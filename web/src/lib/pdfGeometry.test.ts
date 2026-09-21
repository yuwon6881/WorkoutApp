import { describe, expect, it } from 'vitest';
import { positionPiece } from './pdfGeometry';
import { rotatedPiece } from './pdfPieces.fixtures';

describe('PDF text geometry', () => {
  it('uses the run advance, not a font-scaled matrix value, for a rotated span', () => {
    const positioned = positionPiece(rotatedPiece('Upper 1', 90, 100, 35, 12));
    expect(positioned).toMatchObject({ x: 78, endX: 90, y: 135, yStart: 100, yEnd: 135 });
  });

  it('supports the opposite quarter-turn direction', () => {
    const positioned = positionPiece(rotatedPiece('DAY 1', 90, 100, 25, 12, 'ccw'));
    expect(positioned).toMatchObject({ x: 90, endX: 102, y: 100, yStart: 75, yEnd: 100 });
  });
});
