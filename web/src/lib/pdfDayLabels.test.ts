import { describe, expect, it } from 'vitest';
import { associateDayLabels, dayLabelLine, findDayLabels, type DayLabel } from './pdfDayLabels';
import { positionPieces } from './pdfGeometry';
import { buildPageText } from './pdfText';
import { horizontalPiece, rotatedPiece } from './pdfPieces.fixtures';

describe('PDF day labels', () => {
  it('joins adjacent rotated fragments into one marked source label', () => {
    const pieces = positionPieces([
      rotatedPiece('FULL', 60, 100, 20), rotatedPiece('BODY', 60, 121, 20), rotatedPiece('1', 60, 142, 5),
      horizontalPiece('Exercise', 120, 150, 50), horizontalPiece('Sets', 240, 150, 20),
      horizontalPiece('Bench Press', 120, 130, 60), horizontalPiece('Reps', 300, 150, 20),
      horizontalPiece('8-10', 300, 130, 20), horizontalPiece('RPE', 360, 150, 20),
      horizontalPiece('8', 360, 130, 6)
    ]);
    const labels = findDayLabels(pieces);
    expect(labels).toHaveLength(1);
    expect(dayLabelLine(labels[0])).toBe('DAY LABEL: FULL BODY 1');
    expect(labels[0].pieces).toHaveLength(3);
  });

  it('uses a horizontal day-vocabulary fallback and leaves structural banners alone', () => {
    const pieces = positionPieces([
      horizontalPiece('Arms & Weak Points #1', 20, 200),
      horizontalPiece('BLOCK 1', 20, 180), horizontalPiece('WEEK 1', 20, 160)
    ]);
    expect(findDayLabels(pieces).map(dayLabelLine)).toEqual(['DAY LABEL: Arms & Weak Points #1']);
  });

  it('prefers a descriptive table header over a margin tab that only counts the day', () => {
    // Jeff Nippard's Upper/Lower prints "DAY 1" down the page spine and "LOWER #1" as the table
    // header. Taking the spine tab renamed every session after its position and said nothing.
    const pieces = positionPieces([
      rotatedPiece('DAY 1', 17, 200, 30), rotatedPiece('DAY 2', 17, 100, 30),
      horizontalPiece('LOWER #1', 60, 210, 40), horizontalPiece('Exercise', 140, 210, 50),
      horizontalPiece('Back Squat', 140, 190, 60),
      horizontalPiece('UPPER #1', 60, 110, 40), horizontalPiece('Exercise', 140, 110, 50),
      horizontalPiece('Bench Press', 140, 90, 60)
    ]);
    expect(findDayLabels(pieces).map(dayLabelLine)).toEqual(['DAY LABEL: LOWER #1', 'DAY LABEL: UPPER #1']);
  });

  it('keeps a superseded spine tab out of the table text', () => {
    // Left in the rows, the tab is read into the exercise beside it: "DAY 1 DUMBBELL WALKING LUNGE".
    const text = buildPageText([
      rotatedPiece('DAY 1', 17, 120, 30),
      horizontalPiece('LEGS #1', 60, 210, 40), horizontalPiece('SETS', 140, 210, 20), horizontalPiece('REPS', 200, 210, 20),
      horizontalPiece('REST', 260, 210, 20),
      horizontalPiece('BACK SQUAT', 60, 190, 50), horizontalPiece('4', 145, 190, 5), horizontalPiece('5', 205, 190, 5),
      horizontalPiece('3-4MIN', 260, 190, 30),
      horizontalPiece('DUMBBELL WALKING LUNGE', 30, 130, 70), horizontalPiece('2', 145, 130, 5),
      horizontalPiece('20', 205, 130, 10), horizontalPiece('1-2MIN', 260, 130, 30)
    ]);
    expect(text).toContain('DAY LABEL: LEGS #1');
    expect(text).not.toContain('DAY 1');
  });

  it('keeps a margin tab that names the day rather than counting it', () => {
    const pieces = positionPieces([
      rotatedPiece('UPPER', 17, 200, 30),
      horizontalPiece('PUSH', 60, 210, 40), horizontalPiece('Exercise', 140, 210, 50),
      horizontalPiece('Bench Press', 140, 190, 60)
    ]);
    expect(findDayLabels(pieces).map(dayLabelLine)).toEqual(['DAY LABEL: UPPER']);
  });

  it('does not treat landscape table content or chart axes as a rotated day title', () => {
    const landscape = positionPieces([
      rotatedPiece('Exercise', 100, 100), rotatedPiece('Sets', 200, 100),
      rotatedPiece('Bench Press', 100, 80), rotatedPiece('3', 200, 80)
    ]);
    const chart = positionPieces([
      rotatedPiece('Volume (sets per week)', 20, 80, 40),
      horizontalPiece('Exercise', 100, 100), horizontalPiece('Bench Press', 100, 80),
      horizontalPiece('Sets', 200, 100), horizontalPiece('3', 200, 80)
    ]);
    expect(findDayLabels(landscape)).toEqual([]);
    expect(findDayLabels(chart)).toEqual([]);
  });

  it('places each label before its overlapping table header', () => {
    const labels = findDayLabels(positionPieces([
      rotatedPiece('Upper 1', 60, 100, 60),
      horizontalPiece('Exercise', 120, 150), horizontalPiece('Squat', 120, 130)
    ]));
    const [associated] = associateDayLabels(labels, [{ top: 150, bottom: 125 }]);
    expect(associated.y).toBeGreaterThan(150);
  });

  it('uses margin proximity to pair two labels with their own overlapping tables', () => {
    const labels: DayLabel[] = [
      { text: 'Upper 1', x: 20, top: 240, bottom: 150, y: 240, pieces: [] },
      { text: 'Lower 1', x: 650, top: 240, bottom: 150, y: 240, pieces: [] }
    ];
    const associated = associateDayLabels(labels, [
      { top: 300, bottom: 100, left: 100, right: 400 },
      { top: 250, bottom: 0, left: 700, right: 1000 }
    ]);

    expect(associated.map(label => [label.text, label.y])).toEqual([
      ['Upper 1', 300.01], ['Lower 1', 250.01]
    ]);
  });
});
