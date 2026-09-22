import { describe, expect, it } from 'vitest';
import { findHeaderBands, renderRow } from './pdfHeaderColumns';
import type { PositionedPiece, TextRow } from './pdfGeometry';

function piece(str: string, x: number, y: number, width: number): PositionedPiece {
  return {
    str, x, y, endX: x + width, yStart: y - 5, yEnd: y + 5, rotated: false,
    width, transform: [10, 0, 0, 10, x, y]
  };
}

function row(y: number, items: PositionedPiece[]): TextRow {
  return { y, items: [...items].sort((left, right) => left.x - right.x) };
}

describe('findHeaderBands', () => {
  it('joins Essentials-style stacked labels by their shared x intervals', () => {
    const rows = [
      row(700, [
        piece('Exercise', 100, 700, 45), piece('Warm-up', 200, 700, 50), piece('WORKING', 300, 700, 50),
        piece('Reps', 400, 700, 25), piece('Load', 450, 700, 25), piece('RPE', 500, 700, 20),
        piece('Rest', 550, 700, 20), piece('Substitution', 600, 700, 70),
        piece('Substitution', 720, 700, 70), piece('NOTES', 840, 700, 35)
      ]),
      row(688, [
        piece('Sets', 210, 688, 25), piece('SETS', 310, 688, 30),
        piece('Option 1', 610, 688, 50), piece('Option 2', 730, 688, 50)
      ])
    ];

    const band = findHeaderBands(rows, 8)[0];

    expect(band).toMatchObject({ topY: 700, bottomY: 688, skipYValues: [700, 688] });
    expect(band.text).toBe('Exercise | Warm-up Sets | WORKING SETS | Reps | Load | RPE | Rest | Substitution Option 1 | Substitution Option 2 | NOTES');
    expect(band.centers).toHaveLength(10);
    expect(band.centers).toEqual([...band.centers].sort((left, right) => left - right));
  });

  it('fans one spanning parent heading out to its separate child columns', () => {
    const rows = [
      row(700, [
        piece('Exercise', 100, 700, 45), piece('Working Sets', 200, 700, 65),
        piece('Reps', 300, 700, 25), piece('RPE', 400, 700, 20),
        piece('Substitution', 600, 700, 150)
      ]),
      row(688, [piece('Option 1', 610, 688, 50), piece('Option 2', 700, 688, 50)])
    ];

    const band = findHeaderBands(rows, 8)[0];
    const firstSubstitution = band.centers.at(-2)!;
    const secondSubstitution = band.centers.at(-1)!;

    expect(band.text).toContain('Substitution Option 1 | Substitution Option 2');
    expect(secondSubstitution).toBeGreaterThan(firstSubstitution);
    expect(band.centers).toHaveLength(6);
  });

  it('keeps a single-baseline header byte-for-byte compatible with the original renderer', () => {
    const header = row(700, [
      piece('Exercise', 100, 700, 45), piece('Warm-up', 200, 700, 45), piece('Sets', 248, 700, 24),
      piece('Working', 320, 700, 45), piece('Sets', 368, 700, 24), piece('Reps', 430, 700, 25),
      piece('Load', 490, 700, 25), piece('RPE', 550, 700, 20), piece('Rest', 610, 700, 20)
    ]);

    const band = findHeaderBands([header], 8)[0];

    expect(band.text).toBe('Exercise | Warm-up Sets | Working Sets | Reps | Load | RPE | Rest');
    expect(band.text).toBe(renderRow(header, { centers: band.centers }, 8 * 2.35));
    expect(band.skipYValues).toEqual([700]);
  });

  it('does not absorb a nearby data row after the header-band gap', () => {
    const header = row(700, [
      piece('Exercise', 100, 700, 45), piece('Working Sets', 200, 700, 55),
      piece('Reps', 300, 700, 25), piece('RPE', 400, 700, 20), piece('Rest', 500, 700, 20)
    ]);
    const data = row(681, [
      piece('Bench Press', 100, 681, 55), piece('3', 200, 681, 10), piece('6-8', 300, 681, 20),
      piece('8', 400, 681, 8), piece('2 min', 500, 681, 25)
    ]);

    const bands = findHeaderBands([header, data], 8);

    expect(bands).toHaveLength(1);
    expect(bands[0].skipYValues).toEqual([700]);
    expect(bands[0].text).not.toContain('Bench Press');
  });

  it('separates Warm-up and WORKING when gap is small and matches working header label', () => {
    const rows = [
      row(862.5, [
        piece('Exercise', 234, 862.5, 45), piece('Warm-up', 400, 862.5, 50), piece('WORKING', 460, 862.5, 50),
        piece('REPS', 570, 862.5, 30), piece('RPE', 660, 862.5, 20), piece('REST', 740, 862.5, 25)
      ]),
      row(852.5, [
        piece('Sets', 410, 852.5, 25), piece('SETS', 470, 852.5, 25)
      ])
    ];

    const band = findHeaderBands(rows, 16)[0];
    expect(band.text).toContain('Warm-up Sets | WORKING SETS');
    expect(band.columns?.map(c => c.label)).toEqual([
      'Exercise', 'Warm-up Sets', 'WORKING SETS', 'REPS', 'RPE', 'REST'
    ]);
  });
});
