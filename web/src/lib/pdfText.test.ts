import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPageText, extractPdfText } from './pdfText';

const pdfjsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn()
}));

vi.mock('pdfjs-dist', () => pdfjsMock);

/// pdf.js hands back text in content-stream order with each piece's position. A training table's
/// cells arrive in whatever order the document happened to draw them, so reading order has to be
/// rebuilt from those positions — otherwise a week's sets and reps interleave into nonsense.
function piece(text: string, x: number, y: number, width = text.length * 5) {
  return { str: text, transform: [1, 0, 0, 1, x, y], width };
}

function rotatedPiece(text: string, x: number, rowY: number, width = text.length * 5) {
  // A quarter-turn text matrix stores the line position along its vertical baseline.
  return { str: text, transform: [0, 1, -1, 0, x, rowY - width], width, height: 10 };
}

function pdfFile(): File {
  return { name: 'fixture.pdf', arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) } as unknown as File;
}

function loadDocument(document: { numPages: number; getPage: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }) {
  const loadingTaskDestroy = vi.fn().mockResolvedValue(undefined);
  pdfjsMock.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy: loadingTaskDestroy });
  return loadingTaskDestroy;
}

beforeEach(() => {
  pdfjsMock.getDocument.mockReset();
  pdfjsMock.GlobalWorkerOptions.workerSrc = '';
});

describe('buildPageText', () => {
  it('pairs a block badge with its vertically printed number', () => {
    const text = buildPageText([
      piece('BLOCK', 40, 940, 45),
      piece('Shoulder Hypertrophy', 140, 934, 120),
      piece('2', 65, 885, 10)
    ]);
    expect(text).toContain('BLOCK 2');
    expect(text.split('\n')).not.toContain('2');
  });

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

  it('uses close header-aligned columns even when the cell gaps are smaller than normal word spacing', () => {
    const text = buildPageText([
      piece('Exercise', 100, 700, 40), piece('Sets', 148, 700, 20), piece('Reps', 175, 700, 25),
      piece('RPE/%1RM', 205, 700, 50), piece('Rest', 263, 700, 20),
      piece('Bench Press', 100, 680, 50), piece('3', 148, 680, 8), piece('6-8', 175, 680, 15),
      piece('75% 1RM', 205, 680, 45), piece('2 min', 263, 680, 25)
    ]);

    expect(text).toBe([
      'Exercise | Sets | Reps | RPE/%1RM | Rest',
      'Bench Press | 3 | 6-8 | 75% 1RM | 2 min'
    ].join('\n'));
  });

  it('keeps Min-Max dual RIR columns and wrapped notes under the source header columns', () => {
    const headers = [
      ['Exercise', 100, 50], ['Warm-Up Sets', 260, 70], ['Working Sets', 440, 70],
      ['Set 1 RIR', 620, 55], ['Set 2 RIR', 790, 55], ['Rest', 960, 30],
      ['Substitutions', 1090, 70], ['Notes', 1280, 35]
    ] as const;
    const headerItems = headers.map(([label, x, width]) => piece(label, x, 700, width));
    const row = [
      piece('Squat (Your Choice)', 100, 680, 100), piece('N/A', 260, 680, 20),
      piece('2', 440, 680, 8), piece('2-3', 620, 680, 15), piece('1-2', 790, 680, 15),
      piece('3-5 min', 960, 680, 40), piece('Hack Squat', 1090, 680, 55),
      piece('Choose a squat', 1280, 680, 70), piece('that suits you', 1280, 670, 65)
    ];

    expect(buildPageText([...headerItems, ...row])).toBe([
      'Exercise | Warm-Up Sets | Working Sets | Set 1 RIR | Set 2 RIR | Rest | Substitutions | Notes',
      'Squat (Your Choice) | N/A | 2 | 2-3 | 1-2 | 3-5 min | Hack Squat | Choose a squat that suits you'
    ].join('\n'));
  });

  it('reconstructs Min-Max multi-line tracking headers and wrapped movement names by column', () => {
    const headers = [
      piece('Tracking Load and Reps', 887, 1128, 189), piece('Failure?', 1239, 1128, 64),
      piece('Substitution', 1484, 1112, 105), piece('Option 1', 1503, 1094, 67),
      piece('Substitution', 1627, 1112, 105), piece('Option 2', 1646, 1094, 67),
      piece('Last-Set Intensity', 338, 1111, 146), piece('Technique', 370, 1093, 82),
      piece('Warm-up', 514, 1111, 71), piece('Sets', 532, 1093, 36),
      piece('WORKING', 611, 1111, 68), piece('SETS', 629, 1093, 36),
      piece('Rep', 728, 1111, 28), piece('Range', 717, 1093, 49),
      piece('SET 1', 867, 1103, 39), piece('LOAD', 818, 1076, 38), piece('REPS', 915, 1076, 37),
      piece('SET 2', 1059, 1103, 39), piece('LOAD', 1010, 1076, 38), piece('REPS', 1107, 1076, 37),
      piece('RIR', 1209, 1099, 23), piece('(Set 1)', 1196, 1081, 49),
      piece('RIR', 1305, 1099, 23), piece('(Set 2)', 1292, 1081, 49),
      piece('Rest', 1397, 1105, 36), piece('Exercise', 215, 1104, 68), piece('NOTES', 2000, 1103, 47)
    ];
    const text = buildPageText([
      piece('Upper 2', 125, 1300, 40), piece('WEEK 2', 88, 1103, 62), ...headers,
      piece('1-Arm Reverse', 201, 1024, 94), piece('Pec Deck', 218, 1006, 61),
      piece('N/A', 398, 1015, 27), piece('0-1', 538, 1015, 21), piece('1', 642, 1015, 8),
      piece('8-10', 727, 1015, 29), piece('0', 1217, 1015, 8), piece('N/A', 1304, 1015, 27),
      piece('1-2 min', 1391, 1015, 50), piece('Lying Reverse DB Flye', 1475, 1015, 121),
      piece('Reverse Cable Crossover', 1627, 1015, 130), piece('Sweep the weight out', 1774, 1024, 140),
      piece('to make a large arc.', 1774, 1006, 110)
    ]);

    expect(text).toBe([
      'DAY LABEL: Upper 2',
      'Exercise | Last-Set Intensity Technique | Warm-up Sets | Working Sets | Rep Range | Tracking Load Set 1 | Tracking Reps Set 1 | Tracking Load Set 2 | Tracking Reps Set 2 | RIR Set 1 | RIR Set 2 | Rest | Substitution Option 1 | Substitution Option 2 | Notes',
      'WEEK 2',
      '1-Arm Reverse Pec Deck | N/A | 0-1 | 1 | 8-10 |  |  |  |  | 0 | N/A | 1-2 min | Lying Reverse DB Flye | Reverse Cable Crossover | Sweep the weight out to make a large arc.'
    ].join('\n'));
  });

  it('reconstructs newer warm-up, working-set, RPE, technique, substitution, and note columns', () => {
    const items = [
      piece('Exercise', 100, 700, 45), piece('Warm-Up Sets', 200, 700, 55),
      piece('Working Sets', 320, 700, 55), piece('Early Set RPE', 440, 700, 65),
      piece('Last Set RPE', 570, 700, 60), piece('Last Set Techniques', 690, 700, 85),
      piece('Substitutions', 840, 700, 60), piece('Notes', 930, 700, 30),
      piece('Incline DB Press', 100, 680, 75), piece('2', 200, 680, 8),
      piece('3', 320, 680, 8), piece('7-8', 440, 680, 15), piece('9', 570, 680, 8),
      piece('Drop set', 690, 680, 40), piece('Machine Press', 840, 680, 65), piece('Controlled', 930, 680, 45)
    ];

    expect(buildPageText(items)).toBe([
      'Exercise | Warm-Up Sets | Working Sets | Early Set RPE | Last Set RPE | Last Set Techniques | Substitutions | Notes',
      'Incline DB Press | 2 | 3 | 7-8 | 9 | Drop set | Machine Press | Controlled'
    ].join('\n'));
  });

  it('keeps header words split by pdf.js in the same aligned column label', () => {
    const text = buildPageText([
      piece('Exercise', 100, 700, 45), piece('Early', 200, 700, 25), piece('Set', 228, 700, 15),
      piece('RPE', 246, 700, 18), piece('Last', 320, 700, 20), piece('Set', 343, 700, 15),
      piece('RPE', 361, 700, 18), piece('Rest', 440, 700, 20),
      piece('Bench Press', 100, 680, 50), piece('7-8', 200, 680, 15),
      piece('9', 320, 680, 8), piece('2 min', 440, 680, 25)
    ]);

    expect(text).toBe([
      'Exercise | Early Set RPE | Last Set RPE | Rest',
      'Bench Press | 7-8 | 9 | 2 min'
    ].join('\n'));
  });

  it('refreshes columns for repeated legacy headers and preserves several workouts on one page', () => {
    const items = [
      piece('Exercise', 100, 700, 40), piece('Sets', 200, 700, 20), piece('Reps', 270, 700, 20),
      piece('RPE/%1RM', 340, 700, 45), piece('Rest', 450, 700, 20), piece('LSRPE', 520, 700, 30),
      piece('Front Squat', 100, 680, 50), piece('4', 200, 680, 8), piece('6/6', 270, 680, 15),
      piece('75% 1RM', 340, 680, 40), piece('3 min', 450, 680, 25), piece('8', 520, 680, 8),
      piece('Exercise', 100, 640, 40), piece('Sets', 200, 640, 20), piece('Reps', 270, 640, 20),
      piece('RPE/%1RM', 340, 640, 45), piece('Rest', 450, 640, 20), piece('LSRPE', 520, 640, 30),
      piece('Romanian Deadlift', 100, 620, 80), piece('3', 200, 620, 8), piece('10/10', 270, 620, 25),
      piece('RPE 8', 340, 620, 30), piece('2 min', 450, 620, 25), piece('9', 520, 620, 8)
    ];

    const lines = buildPageText(items).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('Front Squat | 4 | 6/6 | 75% 1RM | 3 min | 8');
    expect(lines[3]).toBe('Romanian Deadlift | 3 | 10/10 | RPE 8 | 2 min | 9');
  });

  it('normalizes quarter-turned landscape text into reading order', () => {
    const text = buildPageText([
      rotatedPiece('Sets', 180, 700, 20), rotatedPiece('Exercise', 100, 700, 40),
      rotatedPiece('3', 180, 680, 8), rotatedPiece('Bench Press', 100, 680, 50)
    ]);
    expect(text).toBe('Exercise | Sets\nBench Press | 3');
  });

  it('places vertical day labels at the leading edge of their workout table', () => {
    const verticalDay = { str: 'Day 1', transform: [0, 1, -1, 0, 90, 90], width: 35, height: 10 };
    const text = buildPageText([
      verticalDay,
      piece('Exercise', 120, 120, 40), piece('Sets', 300, 120, 20), piece('Reps', 400, 120, 20),
      piece('Bench Press', 120, 100, 50), piece('3', 300, 100, 8), piece('8-10', 400, 100, 20)
    ]);
    expect(text.split('\n')[0]).toBe('DAY LABEL: Day 1');
    expect(text).toContain('Bench Press');
  });

  it('stops applying table columns after a large vertical gap below the table', () => {
    const headers = [
      ['Exercise', 100, 50], ['Warm-Up Sets', 260, 70], ['Working Sets', 440, 70],
      ['Set 1 RIR', 620, 55], ['Set 2 RIR', 790, 55], ['Rest', 960, 30],
      ['Substitutions', 1090, 70], ['Notes', 1280, 35]
    ] as const;
    const text = buildPageText([
      ...headers.map(([label, x, width]) => piece(label, x, 700, width)),
      piece('Squat', 100, 680, 35), piece('N/A', 260, 680, 20), piece('2', 440, 680, 8),
      piece('2-3', 620, 680, 15), piece('1-2', 790, 680, 15), piece('3-5 min', 960, 680, 40),
      piece('Hack Squat', 1090, 680, 55), piece('Choose a squat', 1280, 680, 70),
      piece('Source note', 100, 600, 55), piece('continues', 1280, 600, 45)
    ]);

    expect(text.split('\n').at(-1)).toBe('Source note | continues');
  });

  it('excludes schedule labels on the same baseline from header bands', () => {
    const text = buildPageText([
      piece('WEEK 1', 93, 862.5, 50),
      piece('Exercise', 234, 862.5, 45), piece('Warm-up Sets', 400, 862.5, 65), piece('WORKING SETS', 480, 862.5, 65),
      piece('Reps', 570, 862.5, 30), piece('Rest', 660, 862.5, 25),
      piece('Bench Press', 234, 800, 60), piece('3-4', 400, 800, 20), piece('2', 480, 800, 8),
      piece('6-8', 570, 800, 20), piece('3 min', 660, 800, 30)
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('WEEK 1');
    expect(lines[1]).toBe('Exercise | Warm-up Sets | WORKING SETS | Reps | Rest');
    expect(lines[2]).toBe('Bench Press | 3-4 | 2 | 6-8 | 3 min');
  });

  it('reconstructs multiline wrapped exercise table cells into single clean rows', () => {
    const text = buildPageText([
      piece('Exercise', 234, 862.5, 45), piece('Warm-up Sets', 400, 862.5, 65), piece('WORKING SETS', 488, 862.5, 65),
      piece('Reps', 574, 862.5, 30), piece('Substitutions 1', 958, 862.5, 80), piece('Substitutions 2', 1101, 862.5, 80),
      piece('Notes', 1446, 862.5, 35),
      piece('Machine Chest', 1101, 801, 80),
      piece('Set up a comfortable arch and', 1446, 801, 150),
      piece('Bench Press', 234, 792.5, 65), piece('3-4', 400, 792.5, 20), piece('1', 488, 792.5, 8),
      piece('3-5', 574, 792.5, 20), piece('DB Bench Press', 958, 792.5, 75),
      piece('Press', 1101, 783.5, 30),
      piece('explode up on each rep.', 1446, 783.5, 120)
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Exercise | Warm-up Sets | WORKING SETS | Reps | Substitutions 1 | Substitutions 2 | Notes');
    expect(lines[1]).toBe('Bench Press | 3-4 | 1 | 3-5 | DB Bench Press | Machine Chest Press | Set up a comfortable arch and explode up on each rep.');
  });
});

describe('extractPdfText failures and cancellation', () => {
  it('surfaces unknown page extraction failures instead of reporting an image-only page', async () => {
    const document = {
      numPages: 1,
      getPage: vi.fn().mockRejectedValue(new Error('unexpected parser failure')),
      destroy: vi.fn().mockResolvedValue(undefined)
    };
    loadDocument(document);

    await expect(extractPdfText(pdfFile())).rejects.toThrow('Page 1 could not be read');
    expect(document.destroy).toHaveBeenCalledOnce();
  });

  it('translates password-protected PDFs into an actionable message', async () => {
    const loadingTaskDestroy = vi.fn().mockResolvedValue(undefined);
    const passwordError = Object.assign(new Error('password required'), { name: 'PasswordException' });
    const promise = Promise.reject(passwordError);
    void promise.catch(() => undefined);
    pdfjsMock.getDocument.mockReturnValue({ promise, destroy: loadingTaskDestroy });

    await expect(extractPdfText(pdfFile())).rejects.toThrow('password-protected');
    expect(loadingTaskDestroy).toHaveBeenCalledOnce();
  });

  it('translates memory failures while reading a page into an actionable message', async () => {
    const document = {
      numPages: 1,
      getPage: vi.fn().mockRejectedValue(new RangeError('Invalid array length')),
      destroy: vi.fn().mockResolvedValue(undefined)
    };
    loadDocument(document);

    await expect(extractPdfText(pdfFile())).rejects.toThrow('browser ran out of room');
    expect(document.destroy).toHaveBeenCalledOnce();
  });

  it('cancels between pages and destroys the active document', async () => {
    const document = {
      numPages: 2,
      getPage: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined)
    };
    loadDocument(document);
    const controller = new AbortController();

    await expect(extractPdfText(pdfFile(), page => {
      if (page === 1) controller.abort();
    }, controller.signal)).rejects.toThrow('PDF import cancelled');
    expect(document.getPage).not.toHaveBeenCalled();
    expect(document.destroy).toHaveBeenCalledOnce();
  });

  it('cancels cleanly and throws PDF import cancelled even if document destroy rejects', async () => {
    const document = {
      numPages: 2,
      getPage: vi.fn(),
      destroy: vi.fn().mockRejectedValue(new Error('Worker already terminated'))
    };
    loadDocument(document);
    const controller = new AbortController();

    await expect(extractPdfText(pdfFile(), page => {
      if (page === 1) controller.abort();
    }, controller.signal)).rejects.toThrow('PDF import cancelled');
    expect(document.destroy).toHaveBeenCalledOnce();
  });

  it('cancels while getPage is pending and stops further extraction', async () => {
    const controller = new AbortController();
    const document = {
      numPages: 5,
      getPage: vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(new Error('Page reading aborted'));
      }),
      destroy: vi.fn().mockResolvedValue(undefined)
    };
    loadDocument(document);

    await expect(extractPdfText(pdfFile(), undefined, controller.signal)).rejects.toThrow('PDF import cancelled');
    expect(document.getPage).toHaveBeenCalledTimes(1);
    expect(document.destroy).toHaveBeenCalledOnce();
  });
});
