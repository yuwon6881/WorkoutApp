import { describe, expect, it } from 'vitest';
import { horizontalPiece } from './pdfPieces.fixtures';
import type { TextPiece } from './pdfGeometry';
import { buildPageText } from './pdfText';

/// Powerbuilding 3.0 prints each day's title in the table's left margin, one word per line and
/// larger than the table text. The coordinates below are the ones pdf.js reports for week 1.
function header(y: number, week = 'WEEK 1'): TextPiece[] {
  const cell = (text: string, x: number, width: number) => horizontalPiece(text, x, y, width, 11);
  return [
    cell(week, 38.8, 24.1), cell('EXERCISE', 113.44, 31), cell('WARM-UP SETS', 186.85, 52.1),
    cell('WORKING SETS', 256.6, 50.3), cell('REPS', 329.83, 16.6), cell('%1RM', 375.93, 19.6),
    cell('RPE', 433.4, 12.8), cell('REST', 484.78, 15.8), cell('NOTES', 838.68, 21)
  ];
}

function row(y: number, name: string, nameX: number, values: [string, string, string, string, string, string]): TextPiece[] {
  const cell = (text: string, x: number) => horizontalPiece(text, x, y, text.length * 4.5, 9);
  const [warmup, working, reps, load, rpe, rest] = values;
  return [cell(name, nameX), cell(warmup, 211.2), cell(working, 280.3), cell(reps, 336.6),
    cell(load, 373.2), cell(rpe, 435.2), cell(rest, 482.8)];
}

function stackedTitle(words: string[], top: number): TextPiece[] {
  return words.map((word, index) => horizontalPiece(word, 40, top - index * 18, word.length * 5, 15));
}

describe('stacked margin day titles', () => {
  it('reads the stacked words as the day title instead of fusing them into exercise names', () => {
    const text = buildPageText([
      ...header(545.32),
      ...stackedTitle(['FULL', 'BODY', '1'], 503.54),
      ...row(526.34, 'BACK SQUAT (TOP SINGLE)', 93.08, ['4', '1', '1', '85-87.5%', '~6-8', '3-5MIN']),
      ...row(508.34, 'BACK SQUAT', 112.23, ['0', '3', '5', '75-77.5%', '7-8', '3-5MIN']),
      ...row(490.34, 'BARBELL OVERHEAD PRESS', 92.27, ['3', '2', '8', '70%', '6', '2-3MIN']),
      ...row(465.17, 'PIN GOOD MORNING', 90.16, ['2', '2', '8-10', 'N/A', '6', '2-3MIN']),
      ...row(440.01, 'CHEST-SUPPORTED ROW', 95.89, ['1', '4', '8-10', 'N/A', '9', '1-2MIN'])
    ]);

    const lines = text.split('\n');
    expect(lines[0]).toBe('DAY LABEL: FULL BODY 1');
    expect(lines.filter(line => line.includes(' | ')).map(line => line.split(' | ')[0])).toEqual([
      'EXERCISE', 'BACK SQUAT (TOP SINGLE)', 'BACK SQUAT', 'BARBELL OVERHEAD PRESS', 'PIN GOOD MORNING', 'CHEST-SUPPORTED ROW'
    ]);
  });

  it('titles each day where its rows begin when one table holds several days', () => {
    const text = buildPageText([
      ...header(545.32),
      ...stackedTitle(['FULL', 'BODY', '1'], 520),
      ...row(526.34, 'BACK SQUAT', 112.23, ['4', '1', '2', '85%', '7', '3-4MIN']),
      ...row(508.34, 'BARBELL BENCH PRESS', 96.45, ['4', '1', '4', '80%', '8', '3-4MIN']),
      ...row(490.34, 'SEATED FACE PULL', 100, ['0', '4', '15-20', 'N/A', '9', '1-2MIN']),
      ...row(472.34, 'CHIN-UP', 118, ['1', '3', '8', 'N/A', '8', '2-3MIN']),
      ...stackedTitle(['FULL', 'BODY', '2'], 436),
      ...row(454, 'DEADLIFT', 116.12, ['4', '3', '4', '80%', '7', '3-5MIN']),
      ...row(436, 'PEC FLYE', 120, ['1', '2', '12-15', 'N/A', '8', '1-2MIN']),
      ...row(418, 'HAMMER CURL', 115, ['1', '4', '8-10', 'N/A', '9', '1-2MIN'])
    ]);

    const names = text.split('\n').map(line => line.split(' | ')[0]);
    expect(names).toEqual([
      'DAY LABEL: FULL BODY 1', 'WEEK 1', 'EXERCISE', 'BACK SQUAT', 'BARBELL BENCH PRESS', 'SEATED FACE PULL', 'CHIN-UP',
      'DAY LABEL: FULL BODY 2', 'DEADLIFT', 'PEC FLYE', 'HAMMER CURL'
    ]);
  });

  it('keeps a lettered week out of the table and reads a top set written 1+ as its own row', () => {
    const text = buildPageText([
      ...header(382.11, 'WEEK 10A'),
      ...stackedTitle(['SQUAT', 'TEST:'], 340.32),
      ...row(363.12, 'BACK SQUAT', 112.23, ['5', '1+', '1', '100-105%', '9.5-10', '4-6MIN']),
      ...row(345.12, 'LEG CURL', 116.38, ['1', '2', '10', 'N/A', '7', '1-2MIN']),
      ...row(327.12, 'DUMBBELL LATERAL RAISE', 93.5, ['1', '2', '15-20', 'N/A', '7', '1-2MIN'])
    ]);

    const lines = text.split('\n');
    expect(lines).toContain('DAY LABEL: SQUAT TEST');
    expect(lines).toContain('WEEK 10A');
    expect(lines.filter(line => line.includes(' | ')).map(line => line.split(' | ').slice(0, 3).join(' | '))).toEqual([
      'EXERCISE | WARM-UP SETS | WORKING SETS', 'BACK SQUAT | 5 | 1+', 'LEG CURL | 1 | 2', 'DUMBBELL LATERAL RAISE | 1 | 2'
    ]);
  });

  it('leaves large stacked words alone when no table sits beside them', () => {
    // A section cover prints its title large and stacked; that is not a day.
    const text = buildPageText([
      horizontalPiece('WEEK 1', 400, 400, 120, 40),
      horizontalPiece('POWERBUILDING', 380, 340, 260, 40),
      horizontalPiece('3.0', 470, 290, 60, 40),
      horizontalPiece('Some explanatory prose on the cover page.', 100, 100, 200, 10)
    ]);

    expect(text).not.toContain('DAY LABEL');
    expect(text).toContain('POWERBUILDING');
  });
});
