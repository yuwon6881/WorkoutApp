import { describe, expect, it } from 'vitest';
import { buildPageText } from './pdfText';

/// pdf.js hands back text in content-stream order with each piece's position. A training table's
/// cells arrive in whatever order the document happened to draw them, so reading order has to be
/// rebuilt from those positions — otherwise a week's sets and reps interleave into nonsense.
function piece(text: string, x: number, y: number, width = text.length * 5) {
  return { str: text, transform: [1, 0, 0, 1, x, y], width };
}

describe('buildPageText', () => {
  it('reads rows top to bottom and emits column separators for distinct table columns', () => {
    const text = buildPageText([
      piece('8-10', 300, 700),
      piece('Squat', 100, 700),
      piece('Bench', 100, 680),
      piece('5', 300, 680)
    ]);
    expect(text).toBe('Squat | 8-10\nBench | 5');
  });

  it('keeps pieces of one printed line together despite small baseline differences', () => {
    // Superscripts and mixed fonts shift a baseline by a fraction of a point; that is not a new row.
    const text = buildPageText([piece('RPE', 100, 500, 20), piece('8', 125, 501, 8)]);
    expect(text).toBe('RPE 8');
  });

  it('separates adjacent pieces in the same cell that carry no space of their own', () => {
    // A small horizontal gap within the word-spacing range becomes a single space.
    const text = buildPageText([piece('3', 100, 400, 5), piece('sets', 110, 400)]);
    expect(text).toBe('3 sets');
  });

  it('separates table columns with explicit column separator when gap is wide', () => {
    const text = buildPageText([
      piece('Lying Leg Curl', 200, 600, 80),
      piece('N/A', 400, 600, 20),
      piece('2', 640, 600, 10),
      piece('6-8', 730, 600, 25),
      piece('1-2 min', 1390, 600, 50),
      piece('Nordic Ham Curl', 1620, 600, 100)
    ]);
    expect(text).toBe('Lying Leg Curl | N/A | 2 | 6-8 | 1-2 min | Nordic Ham Curl');
  });

  it('preserves multi-line wrapped exercise and substitution cells from training tables', () => {
    // Modeled after Min-Max Page 26 table:
    // Row 1: Exercise head "Squat" + Notes line 1
    // Row 2: Parameters (N/A, 2-4, 2, 6-8, 3, 2, 3-5 min, See Notes, See Notes)
    // Row 3: Exercise tail "(Your Choice)" + Notes line 2
    const text = buildPageText([
      // y = 925
      piece('Squat', 229, 925, 40),
      piece('This can be a Barbell Back Squat, Front Squat, etc.', 1774, 925, 350),
      // y = 917.5
      piece('N/A', 398, 917.5, 20),
      piece('2', 642, 917.5, 10),
      piece('6-8', 731, 917.5, 25),
      piece('3-5 min', 1391, 917.5, 50),
      piece('See Notes', 1501, 917.5, 60),
      piece('See Notes', 1644, 917.5, 60),
      // y = 907.5
      piece('(Your Choice)', 203, 907.5, 75),
      piece('Hack Squat, Belt Squat, or Smith Machine Squat.', 1774, 907.5, 300)
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Squat | This can be a Barbell Back Squat, Front Squat, etc.');
    expect(lines[1]).toBe('N/A | 2 | 6-8 | 3-5 min | See Notes | See Notes');
    expect(lines[2]).toBe('(Your Choice) | Hack Squat, Belt Squat, or Smith Machine Squat.');
  });

  it('joins the pieces of a single kerned word without inventing a space', () => {
    const text = buildPageText([piece('Ro', 100, 400, 10), piece('manian', 110.2, 400)]);
    expect(text).toBe('Romanian');
  });

  it('drops empty pieces and pages that hold nothing but whitespace', () => {
    expect(buildPageText([piece('  ', 100, 400), piece('', 120, 400)])).toBe('');
  });
});
