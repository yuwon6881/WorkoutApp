import { describe, expect, it } from 'vitest';
import { buildPageText } from './pdfText';

/// pdf.js hands back text in content-stream order with each piece's position. A training table's
/// cells arrive in whatever order the document happened to draw them, so reading order has to be
/// rebuilt from those positions — otherwise a week's sets and reps interleave into nonsense.
function piece(text: string, x: number, y: number, width = text.length * 5) {
  return { str: text, transform: [1, 0, 0, 1, x, y], width };
}

describe('buildPageText', () => {
  it('reads rows top to bottom and cells left to right, whatever order they were drawn in', () => {
    const text = buildPageText([
      piece('8-10', 300, 700),
      piece('Squat', 100, 700),
      piece('Bench', 100, 680),
      piece('5', 300, 680)
    ]);
    expect(text).toBe('Squat 8-10\nBench 5');
  });

  it('keeps pieces of one printed line together despite small baseline differences', () => {
    // Superscripts and mixed fonts shift a baseline by a fraction of a point; that is not a new row.
    const text = buildPageText([piece('RPE', 100, 500), piece('8', 130, 501)]);
    expect(text).toBe('RPE 8');
  });

  it('separates adjacent cells that carry no space of their own', () => {
    const text = buildPageText([piece('3', 100, 400, 5), piece('sets', 140, 400)]);
    expect(text).toBe('3 sets');
  });

  it('joins the pieces of a single kerned word without inventing a space', () => {
    const text = buildPageText([piece('Ro', 100, 400, 10), piece('manian', 110.2, 400)]);
    expect(text).toBe('Romanian');
  });

  it('drops empty pieces and pages that hold nothing but whitespace', () => {
    expect(buildPageText([piece('  ', 100, 400), piece('', 120, 400)])).toBe('');
  });
});
