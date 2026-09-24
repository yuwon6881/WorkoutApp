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

  it('does not turn muscle labels beside weekly chart values into workout titles', () => {
    const pieces = positionPieces([
      horizontalPiece('WEEKLY VOLUMES', 20, 240),
      horizontalPiece('CHEST', 20, 220), horizontalPiece('11', 180, 220, 12),
      horizontalPiece('11', 230, 220, 12), horizontalPiece('12', 280, 220, 12),
      horizontalPiece('13', 330, 220, 12), horizontalPiece('11', 380, 220, 12),
      horizontalPiece('11', 430, 220, 12), horizontalPiece('Exercise', 20, 170, 50),
      horizontalPiece('Chest Press', 20, 150, 60), horizontalPiece('8-10', 100, 150, 28)
    ]);

    expect(findDayLabels(pieces)).toEqual([]);
  });

  it('keeps a prose heading out of the workout title stream when the page has no schedule table', () => {
    const text = buildPageText([
      horizontalPiece('Chest', 36, 548, 30),
      horizontalPiece('BODYPART VOLUME DEFINITIONS', 36, 520, 210),
      horizontalPiece('Below is a list of exercises counted toward weekly volume metrics.', 36, 490, 330)
    ]);

    expect(text).not.toContain('DAY LABEL: Chest');
    expect(text).toContain('Chest');
  });

  it('does not turn the generic warmup list heading into a workout title', () => {
    const text = buildPageText([
      horizontalPiece('THE GENERAL WARMUP', 36, 620, 160, 16),
      horizontalPiece('BACK', 36, 580, 42, 15),
      horizontalPiece('EXERCISE', 36, 560, 50, 9), horizontalPiece('SETS', 160, 560, 24, 9),
      horizontalPiece('REPS/TIME', 220, 560, 46, 9), horizontalPiece('NOTES', 320, 560, 30, 9),
      horizontalPiece('Low intensity cardio', 36, 540, 88, 8), horizontalPiece('N/A', 160, 540, 16, 8),
      horizontalPiece('5-10min', 220, 540, 32, 8)
    ]);

    expect(text).not.toContain('DAY LABEL: BACK');
    expect(text).toContain('THE GENERAL WARMUP');
  });

  it('uses a day number in the table header and ignores the distant program heading', () => {
    const text = buildPageText([
      horizontalPiece('ARM HYPERTROPHY', 40, 700, 100),
      horizontalPiece('DAY 1', 40, 580, 35), horizontalPiece('SETS', 100, 580, 30),
      horizontalPiece('REPS', 150, 580, 30), horizontalPiece('TEMPO', 200, 580, 35),
      horizontalPiece('APE', 270, 580, 22), horizontalPiece('REST', 310, 580, 30),
      horizontalPiece('Close Grip Bench Press', 40, 560, 120), horizontalPiece('3', 100, 560, 8),
      horizontalPiece('6-8', 150, 560, 20), horizontalPiece('2:1:1:1', 200, 560, 35),
      horizontalPiece('8', 270, 560, 8), horizontalPiece('3.0', 310, 560, 20)
    ]);

    expect(text).toContain('DAY LABEL: DAY 1');
    expect(text).not.toContain('DAY LABEL: ARM HYPERTROPHY');
  });

  it('keeps a stacked workout title beside a leading WORKOUT column out of exercise names', () => {
    const text = buildPageText([
      horizontalPiece('WORKOUT', 38, 520, 36, 9), horizontalPiece('EXERCISE', 98, 520, 42, 9),
      horizontalPiece('# OF WORKING SETS', 250, 520, 70, 9), horizontalPiece('REPS / DURATION', 330, 520, 65, 9),
      horizontalPiece('REST', 420, 520, 20, 9),
      horizontalPiece('DAY 1', 39, 500, 35, 15), horizontalPiece('LOWER', 36, 483, 47, 15),
      horizontalPiece('FOCUSED', 29, 467, 53, 15), horizontalPiece('FULL', 42, 451, 28, 15),
      horizontalPiece('BODY 2', 36, 435, 48, 15),
      horizontalPiece('Back Squat', 98, 500, 48, 8), horizontalPiece('3', 270, 500, 5, 8),
      horizontalPiece('6-8', 350, 500, 18, 8), horizontalPiece('2-3 min', 420, 500, 28, 8),
      horizontalPiece('Leg Press', 98, 480, 38, 8), horizontalPiece('3', 270, 480, 5, 8),
      horizontalPiece('10-12', 350, 480, 22, 8), horizontalPiece('2-3 min', 420, 480, 28, 8)
    ]);

    expect(text).toContain('DAY LABEL: DAY 1 LOWER FOCUSED FULL BODY 2');
    expect(text).toContain('Back Squat | 3 | 6-8 | 2-3 min');
    expect(text).toContain('Leg Press | 3 | 10-12 | 2-3 min');
    expect(text).not.toMatch(/(?:FOCUSED|FULL|BODY) \| (?:Back Squat|Leg Press)/);
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

  it('keeps an exercise-column muscle name out of the day-title stream', () => {
    const text = buildPageText([
      horizontalPiece('Exercise', 100, 530, 50), horizontalPiece('Sets', 200, 530, 24),
      horizontalPiece('Reps', 260, 530, 28), horizontalPiece('Rest', 320, 530, 24),
      horizontalPiece('LOWER #1', 20, 500, 62, 15),
      horizontalPiece('BACK', 100, 500, 30), horizontalPiece('SQUAT', 132, 500, 38),
      horizontalPiece('3', 200, 500, 5), horizontalPiece('8', 260, 500, 5),
      horizontalPiece('3-4MIN', 320, 500, 30)
    ]);

    expect(text).toContain('DAY LABEL: LOWER #1');
    expect(text).not.toContain('DAY LABEL: BACK');
    expect(text).toContain('BACK SQUAT');
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
