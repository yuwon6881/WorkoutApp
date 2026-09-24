import { describe, expect, it } from 'vitest';
import { buildPageText } from './pdfText';

function piece(text: string, x: number, y: number, width = text.length * 5) {
  return { str: text, transform: [1, 0, 0, 1, x, y], width };
}

function rotatedPiece(text: string, x: number, rowY: number, width = text.length * 5) {
  return { str: text, transform: [0, 1, -1, 0, x, rowY - width], width, height: 10 };
}

const header = [
  piece('Exercise', 200, 900, 45), piece('Warm-up Sets', 400, 900, 65), piece('WORKING SETS', 500, 900, 65),
  piece('Reps', 600, 900, 25), piece('Rest', 700, 900, 25), piece('Substitution Option 1', 800, 900, 100),
  piece('NOTES', 1100, 900, 35)
];

/// One padded row the way The Pure Bodybuilding Program prints it: the name wraps over two lines
/// around the row's numbers, and the note wraps over three.
function paddedRow(top: number, first: string, second: string, sets: string) {
  return [
    piece('Keep the form tight and controlled throughout', 950, top, 230),
    piece(first, 200, top - 9, 70),
    piece('1-2', 400, top - 18, 15), piece(sets, 500, top - 18, 6), piece('8-10', 600, top - 18, 20),
    piece('~2-3 min', 700, top - 18, 40), piece('Lat Pulldown', 800, top - 18, 60),
    piece('and pause for one second at the bottom of each', 950, top - 18, 240),
    piece(second, 200, top - 27, 40),
    piece('rep.', 950, top - 36, 20)
  ];
}

describe('padded training tables', () => {
  it('keeps every row of a padded table whole and moves its day title to the top', () => {
    const text = buildPageText([
      ...header,
      ...paddedRow(840, 'Assisted', 'Pull-Up', '3'),
      ...paddedRow(760, 'Chest-Supported', 'Machine Row', '3'),
      rotatedPiece('Upper #2', 100, 800, 60),
      ...paddedRow(680, 'Paused Assisted', 'Dip', '2'),
      piece('Optional Rest Day', 600, 620, 90),
      piece('The Pure Bodybuilding Program | 3', 1000, 500, 160)
    ]);

    const lines = text.split('\n');
    expect(lines[0]).toBe('DAY LABEL: Upper #2');
    expect(lines.slice(2, 5)).toEqual([
      'Assisted Pull-Up | 1-2 | 3 | 8-10 | ~2-3 min | Lat Pulldown | Keep the form tight and controlled throughout and pause for one second at the bottom of each rep.',
      'Chest-Supported Machine Row | 1-2 | 3 | 8-10 | ~2-3 min | Lat Pulldown | Keep the form tight and controlled throughout and pause for one second at the bottom of each rep.',
      'Paused Assisted Dip | 1-2 | 2 | 8-10 | ~2-3 min | Lat Pulldown | Keep the form tight and controlled throughout and pause for one second at the bottom of each rep.'
    ]);
    expect(lines.slice(5)).toEqual(['Optional Rest Day', 'The Pure Bodybuilding Program | 3']);
  });

  it('ends a padded table where the lines after a wide gap carry no set count', () => {
    const text = buildPageText([
      ...header,
      ...paddedRow(840, 'Assisted', 'Pull-Up', '3'),
      piece('Pick one of the options above', 200, 750, 150)
    ]);

    expect(text.split('\n').at(-1)).toBe('Pick one of the options above');
  });
});

describe('wrapped table cells', () => {
  it('joins a name wrapped at its hyphen without a space', () => {
    const text = buildPageText([
      ...header,
      piece('Cuffed Behind-', 200, 830, 70),
      piece('1-2', 400, 821, 15), piece('3', 500, 821, 6), piece('10-12', 600, 821, 25),
      piece('The-Back Lateral', 200, 812, 75),
      piece('Raise', 200, 803, 25)
    ]);

    expect(text.split('\n').at(-1)).toBe('Cuffed Behind-The-Back Lateral Raise | 1-2 | 3 | 10-12');
  });
});

describe('older compact tables', () => {
  const compactHeader = (title: string, y: number) => [
    piece(title, 53, y, 40), piece('SETS', 119, y, 18), piece('REPS', 149, y, 18), piece('RPE', 185, y, 15),
    piece('REST', 226, y, 18), piece('NOTES', 459, y, 25)
  ];
  const compactRow = (name: string, x: number, y: number, sets: string) => [
    piece(name, x, y, 90), piece(sets, 125, y, 4), piece('8', 156, y, 4), piece('7', 189, y, 4),
    piece('2-3MIN', 225, y, 26), piece('KEEP YOUR SCAPULAE RETRACTED', 400, y, 130)
  ];

  it('keeps the name column when the day title stands in for its label', () => {
    const text = buildPageText([
      ...compactHeader('PUSH #2', 700),
      ...compactRow('CLOSE-GRIP BENCH PRESS', 37, 689, '3'),
      ...compactRow('MILITARY PRESS', 49, 675, '4')
    ]);

    const lines = text.split('\n');
    expect(lines[0]).toBe('DAY LABEL: PUSH #2');
    expect(lines.slice(1)).toEqual([
      'Exercise | SETS | REPS | RPE | REST | NOTES',
      'CLOSE-GRIP BENCH PRESS | 3 | 8 | 7 | 2-3MIN | KEEP YOUR SCAPULAE RETRACTED',
      'MILITARY PRESS | 4 | 8 | 7 | 2-3MIN | KEEP YOUR SCAPULAE RETRACTED'
    ]);
  });

  it('keeps a footer note under the last row out of that row', () => {
    const text = buildPageText([
      ...compactHeader('FULL BODY #1', 700),
      ...compactRow('BACK SQUAT', 63, 673, '3'),
      ...compactRow('LAT PULLDOWN', 59, 650, '3'),
      ...compactRow('DUMBBELL SUPINATED CURL', 40, 627, '3'),
      piece('*NOTE: REST TIMES ARE GIVEN IN', 26, 596, 95), piece('MINUTES.', 122, 596, 30)
    ]);

    expect(text.split('\n').slice(-2)).toEqual([
      'DUMBBELL SUPINATED CURL | 3 | 8 | 7 | 2-3MIN | KEEP YOUR SCAPULAE RETRACTED',
      '*NOTE: REST TIMES ARE GIVEN IN MINUTES.'
    ]);
  });
});

describe('two-line count headers', () => {
  it('splits "# OF WORKING SETS" from "REPS / DURATION" and keeps a top-aligned name whole', () => {
    const size = 8;
    const at = (text: string, x: number, y: number, width = text.length * 4) =>
      ({ str: text, transform: [size, 0, 0, size, x, y], width });
    const text = buildPageText([
      at('EXERCISE', 115, 552), at('# OF WARMUP', 180, 552, 44), at('# OF WORKING', 238, 552, 50),
      at('REPS / DURATION', 297, 552, 60), at('REST', 421, 552), at('NOTES', 576, 552),
      at('SETS', 195, 541, 18), at('SETS', 254, 541, 18),
      at('ECCENTRIC-', 115, 520, 44), at('1', 202, 520, 4), at('4', 261, 520, 4), at('8', 325, 520, 4),
      at('1-2 MIN', 419, 520, 28), at('PRESS ONTO YOUR TOES', 516, 520, 90),
      at('ACCENTUATED STANDING', 95, 508, 84),
      at('CALF RAISE', 115, 498.5, 40),
      at('CABLE ROPE UPRIGHT', 100, 486, 72), at('0', 202, 479, 4), at('4', 261, 479, 4), at('10', 324, 479, 8),
      at('1-2 MIN', 418, 479, 28), at('SQUEEZE THE UPPER TRAPS', 500, 479, 100),
      at('ROW', 130, 472, 16)
    ]);

    expect(text.split('\n')).toEqual([
      'EXERCISE | # OF WARMUP SETS | # OF WORKING SETS | REPS / DURATION | REST | NOTES',
      'ECCENTRIC-ACCENTUATED STANDING CALF RAISE | 1 | 4 | 8 | 1-2 MIN | PRESS ONTO YOUR TOES',
      'CABLE ROPE UPRIGHT ROW | 0 | 4 | 10 | 1-2 MIN | SQUEEZE THE UPPER TRAPS'
    ]);
  });
});

describe('notes printed just under a header', () => {
  it('keeps a coaching note out of the header band', () => {
    const size = 12;
    const at = (text: string, x: number, y: number, width = text.length * 6) =>
      ({ str: text, transform: [size, 0, 0, size, x, y], width });
    const text = buildPageText([
      at('Exercise', 200, 1008), at('WORKING SETS', 500, 1008, 70), at('Reps', 600, 1008), at('Rest', 700, 1008),
      at('NOTES', 1000, 1008),
      at('1.5x shoulder width overhand grip. Slow 2-3 second negative. Feel your lats', 950, 993, 330),
      at('Wide-Grip Pull-Up', 200, 978, 90), at('3', 530, 978, 6), at('8-10', 600, 978, 24), at('~2-3 min', 700, 978, 45),
      at('pulling apart on the way down.', 950, 978, 160)
    ]);

    expect(text.split('\n')).toEqual([
      'Exercise | WORKING SETS | Reps | Rest | NOTES',
      'Wide-Grip Pull-Up | 3 | 8-10 | ~2-3 min | 1.5x shoulder width overhand grip. Slow 2-3 second negative. Feel your lats pulling apart on the way down.'
    ]);
  });
});

describe('packed top-aligned rows', () => {
  it('keeps each wrapped name with the row it starts on and the tally under the table', () => {
    const size = 9;
    const at = (text: string, x: number, y: number, width = text.length * 4.5) =>
      ({ str: text, transform: [size, 0, 0, size, x, y], width });
    const text = buildPageText([
      at('EXERCISE', 40, 560), at('SETS', 139, 560), at('REPS', 167, 560), at('REST', 250, 560), at('NOTES', 587, 560),
      at('GOOD MORNING', 52, 475), at('3', 146, 475, 4), at('8', 174, 475, 4), at('1-2MIN', 247, 475), at('KEEP YOUR SPINE NEUTRAL', 557, 475),
      at('ECCENTRIC-ACCENTUATED/', 35, 456), at('4', 146, 456, 4), at('6/6', 170, 456, 12), at('1-2MIN', 247, 456), at('FIRST 6 REPS SLOW', 477, 456),
      at('CONSTANT-TENSION STANDING', 29, 443.6),
      at('CALF RAISE', 60, 431),
      at('CABLE CRUNCH', 54, 416), at('3', 146, 416, 4), at('30', 172, 416, 8), at('1-2MIN', 247, 416), at('ROUND YOUR BACK', 543, 416),
      at('TOTAL SET VOLUME: 18', 23, 397)
    ]);

    expect(text.split('\n').slice(1)).toEqual([
      'GOOD MORNING | 3 | 8 | 1-2MIN | KEEP YOUR SPINE NEUTRAL',
      'ECCENTRIC-ACCENTUATED/ CONSTANT-TENSION STANDING CALF RAISE | 4 | 6/6 | 1-2MIN | FIRST 6 REPS SLOW',
      'CABLE CRUNCH | 3 | 30 | 1-2MIN | ROUND YOUR BACK',
      'TOTAL SET VOLUME: 18'
    ]);
  });
});

describe('doubled and per-side counts', () => {
  it('reads a word drawn twice in place once and anchors a "2 per leg" row', () => {
    const size = 8;
    const at = (text: string, x: number, y: number, width = text.length * 4) =>
      ({ str: text, transform: [size, 0, 0, size, x, y], width });
    const text = buildPageText([
      at('Exercise', 100, 700), at('WORKING SETS', 250, 700, 50), at('Reps', 330, 700), at('Rest', 400, 700),
      at('DEADLIFT', 100, 680), at('DEADLIFT', 100, 680), at('3', 270, 680, 4), at('5', 335, 680, 4), at('3-4 min', 395, 680),
      at('Smith Machine', 100, 609), at('2 per leg', 255, 600, 34), at('10-12', 330, 600), at('~2-3 min', 395, 600),
      at('Reverse Lunge', 100, 591)
    ]);

    expect(text.split('\n').slice(1)).toEqual([
      'DEADLIFT | 3 | 5 | 3-4 min',
      'Smith Machine Reverse Lunge | 2 per leg | 10-12 | ~2-3 min'
    ]);
  });
});

describe('pieces carrying their own line break', () => {
  it('keeps a name that ends in a line break on its row', () => {
    const text = buildPageText([
      ...header,
      piece('Flat DB Press\n', 200, 830, 70),
      piece('2-3', 400, 821, 15), piece('1', 500, 821, 6), piece('4-6', 600, 821, 15),
      piece('(Heavy)', 200, 812, 35)
    ]);

    expect(text.split('\n').at(-1)).toBe('Flat DB Press (Heavy) | 2-3 | 1 | 4-6');
  });
});

describe('compact section tables', () => {
  it('keeps a nearby section title and tight first row out of a compact header band', () => {
    const at = (text: string, x: number, y: number, width: number) => ({
      ...piece(text, x, y, width), transform: [9.118, 0, 0, 9.118, x, y]
    });
    const text = buildPageText([
      at('ARM DAY', 23, 588.6, 56), at('DAY 1', 36.8, 578.97, 38),
      at('SETS', 82.16, 574.41, 19.5), at('REPS', 122.5, 574.41, 20.7),
      at('TEMPO', 167.67, 574.41, 26.4), at('APE', 207.01, 574.41, 15.5),
      at('REST', 232.05, 574.41, 19.7), at('1', 270.98, 574.41, 4.3),
      at('2', 303.21, 574.41, 5.3), at('3', 336.23, 574.41, 5.3), at('4', 368.93, 574.41, 5.5),
      at('NOTES', 477.89, 574.41, 25.6),
      at('CLOSE GRIP BENCH', 22.4, 562.65, 57), at('3', 90.1, 562.65, 4.6),
      at('6-8', 127.9, 562.65, 14), at('2:1:1:1', 172.8, 562.65, 28),
      at('8', 213, 562.65, 4), at('3.0', 237.7, 562.65, 12),
      at('SHOULDER WIDTH GRIP', 404.3, 562.65, 75),
      at('PRESS', 39, 555.15, 20),
      at('MACHINE', 35.5, 543.4, 38), at('2', 90.1, 543.4, 4.6),
      at('12-15', 125.3, 543.4, 20), at('2:0:2:0', 171.7, 543.4, 28),
      at('7', 213.2, 543.4, 4), at('1.0', 238, 543.4, 12),
      at('PREACTIVATION AND CONTROLLED REPS', 391.7, 543.4, 130),
      at('PREACHER CURL', 39, 535.2, 52)
    ]);

    const lines = text.split('\n');
    expect(lines).toContain('DAY LABEL: DAY 1');
    expect(lines).toContain('Exercise | SETS | REPS | TEMPO | APE | REST | 1 | 2 | 3 | 4 | NOTES');
    expect(lines.find(line => line.startsWith('CLOSE GRIP BENCH PRESS |')))
      .toMatch(/^CLOSE GRIP BENCH PRESS \| 3 \| 6-8 \| 2:1:1:1 \| 8 \| 3\.0 \|/);
    expect(lines.find(line => line.startsWith('MACHINE PREACHER CURL |')))
      .toMatch(/^MACHINE PREACHER CURL \| 2 \| 12-15 \| 2:0:2:0 \| 7 \| 1\.0 \|/);
  });

  it('joins grouped tracking headers and their leaf labels on a two-tier table', () => {
    const at = (text: string, x: number, y: number, width: number) => ({
      ...piece(text, x, y, width), transform: [15, 0, 0, 19.8999, x, y]
    });
    const text = buildPageText([
      at('Last-Set Intensity', 338.22, 1016, 145.5), at('Warm-up', 514.24, 1015, 70.49),
      at('WORKING', 610.77, 1015, 67.7), at('Reps', 723.11, 1008, 36.77),
      at('Early', 1199.27, 1016, 43.43), at('Last Set', 1283.67, 1016, 67.01),
      at('Rest', 1397.31, 1008, 36.36), at('Substitution', 1483.69, 1016, 104.57),
      at('Substitution', 1626.69, 1016, 104.57), at('Exercise', 215.13, 1006, 67.68),
      at('WEEK 1', 87.87, 1005, 62.24),
      at('NOTES', 1999.81, 1006, 47.37), at('Technique', 370.13, 998, 81.69),
      at('Sets', 531.48, 997, 36.04), at('SETS', 628.48, 997, 36.04),
      at('SET 1', 818.03, 993, 38.93), at('SET 2', 914.03, 993, 38.93),
      at('SET 3', 1010.03, 993, 38.94), at('SET 4', 1106.03, 993, 38.94),
      at('Set RPE', 1192, 998, 57.97), at('RPE', 1303.19, 998, 27.61),
      at('Option 1', 1502.61, 998, 66.75), at('Option 2', 1645.61, 998, 66.75),
      at('45° Incline Barbell', 188.52, 929, 119.91), at('N/A', 397.66, 920, 26.67),
      at('2-3', 537.99, 920, 21.01), at('1', 642.28, 920, 8.43),
      at('6-8', 730.99, 920, 21.01), at('N/A', 1207.66, 920, 26.67),
      at('~6', 1307.68, 920, 18.63), at('3-5 min', 1390.58, 920, 49.81),
      at('45° Incline DB', 1489.06, 929, 92.84), at('45° Incline', 1643.51, 929, 69.93),
      at('Press', 1516.57, 911, 37.84), at('Machine Press', 1629.08, 911, 98.81),
      at('1 second pause while maintaining tension', 1778, 929, 300)
    ]);

    const lines = text.split('\n');
    expect(lines).toContain('Exercise | Last-Set Intensity Technique | Warm-up Sets | WORKING SETS | Reps | SET 1 | SET 2 | SET 3 | SET 4 | Early Set RPE | Last Set RPE | Rest | Substitution Option 1 | Substitution Option 2 | NOTES');
    expect(lines).toContain('45° Incline Barbell | N/A | 2-3 | 1 | 6-8 |  |  |  |  | N/A | ~6 | 3-5 min | 45° Incline DB Press | 45° Incline Machine Press | 1 second pause while maintaining tension');
    expect(lines.join('\n')).not.toContain('6-8 1');
    expect(lines.join('\n')).not.toContain('~6 3-5 min');
  });

  it('keeps session set volume summaries after the exercise rows', () => {
    const at = (text: string, x: number, y: number, width: number) => ({
      ...piece(text, x, y, width), transform: [9, 0, 0, 9, x, y]
    });
    const text = buildPageText([
      at('EXERCISE', 40, 560, 36), at('SETS', 160, 560, 20), at('REPS', 230, 560, 20), at('REST', 300, 560, 18),
      at('Back Squat', 40, 540, 45), at('3', 160, 540, 5), at('8', 230, 540, 5), at('2-3 min', 300, 540, 28),
      at('SESSION SET VOLUME', 40, 520, 90), at('3', 160, 520, 5)
    ]);

    expect(text.split('\n')).toEqual([
      'EXERCISE | SETS | REPS | REST',
      'Back Squat | 3 | 8 | 2-3 min',
      'SESSION SET VOLUME | 3'
    ]);
  });
});
