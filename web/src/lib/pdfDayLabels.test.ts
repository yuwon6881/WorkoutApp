import { describe, expect, it } from 'vitest';
import { associateDayLabels, dayLabelLine, findDayLabels, type DayLabel } from './pdfDayLabels';
import { positionPieces } from './pdfGeometry';
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
