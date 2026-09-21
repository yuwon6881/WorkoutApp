import { describe, expect, it } from 'vitest';
import { groupRows, positionPieces } from './pdfGeometry';
import { horizontalPiece, trackingPage } from './pdfPieces.fixtures';
import { findTrackingTables, renderTrackingTables } from './pdfTrackingTable';

describe('PDF tracking-table reconstruction', () => {
  it.each([0.5, 1])('keeps the strict tracking signature at page scale %i', scale => {
    const rows = groupRows(positionPieces(trackingPage(scale, 2, 'rir')));
    expect(findTrackingTables(rows)).toHaveLength(1);
  });

  it.each([2, 3, 4])('reconstructs %i load/reps set pairs with indexed RIR columns', setCount => {
    const rows = groupRows(positionPieces(trackingPage(1, setCount, 'rir')));
    const [table] = findTrackingTables(rows);

    expect(table).toBeDefined();
    expect(table?.columns.filter(column => column.label.startsWith('Tracking Load Set '))).toHaveLength(setCount);
    expect(table?.columns.filter(column => column.label.startsWith('Tracking Reps Set '))).toHaveLength(setCount);
    expect(table?.columns.filter(column => column.label.startsWith('RIR Set '))).toHaveLength(setCount);
    expect(renderTrackingTables(rows, [table!])[1]?.text).toContain('Chest Press');
  });

  it.each([2, 3, 4])('accepts indexed set/RIR labels for %i sets', setCount => {
    const rows = groupRows(positionPieces(trackingPage(1, setCount, 'setRir')));
    const [table] = findTrackingTables(rows);

    expect(table).toBeDefined();
    expect(table?.columns.filter(column => column.role === 'effort')).toHaveLength(setCount);
    expect(renderTrackingTables(rows, [table!])[1]?.text).toContain('Chest Press');
  });

  it.each([2, 3, 4])('accepts two RPE columns for %i load/reps sets', setCount => {
    const rows = groupRows(positionPieces(trackingPage(1, setCount, 'rpe')));
    const [table] = findTrackingTables(rows);

    expect(table).toBeDefined();
    expect(table?.columns.filter(column => column.role === 'effort')).toHaveLength(2);
    expect(renderTrackingTables(rows, [table!])[1]?.text).toContain('Chest Press');
  });

  it('accepts an RPE row when only the last-set column carries a numeric value', () => {
    const rows = groupRows(positionPieces(trackingPage(1, 3, 'rpe').filter(piece => piece.str !== '7-8')));
    const [table] = findTrackingTables(rows);

    expect(table?.columns.filter(column => column.role === 'effort')).toHaveLength(2);
    expect(renderTrackingTables(rows, [table!])[1]?.text).toContain('Chest Press');
  });

  it.each([2, 3, 4])('joins split-baseline RPE labels for %i load/reps sets', setCount => {
    const rows = groupRows(positionPieces(trackingPage(1, setCount, 'splitRpe')));
    const [table] = findTrackingTables(rows);

    expect(table).toBeDefined();
    expect(table?.columns.filter(column => column.role === 'effort')).toHaveLength(2);
    expect(renderTrackingTables(rows, [table!])[1]?.text).toContain('Chest Press');
  });

  it('does not claim an unrelated table without the full tracking signature', () => {
    const rows = groupRows(positionPieces(trackingPage(1, 2).filter(piece => piece.str !== 'Option 2')));
    expect(findTrackingTables(rows)).toHaveLength(0);
  });

  it('does not mistake an ordinary load/reps table for the tracking family', () => {
    const rows = groupRows(positionPieces([
      horizontalPiece('Exercise', 100, 700), horizontalPiece('LOAD', 300, 700),
      horizontalPiece('REPS', 450, 700), horizontalPiece('Rest', 600, 700),
      horizontalPiece('Bench Press', 100, 680), horizontalPiece('100', 300, 680),
      horizontalPiece('8', 450, 680), horizontalPiece('2 min', 600, 680)
    ]));

    expect(findTrackingTables(rows)).toHaveLength(0);
  });

  it('does not accept duplicated set indexes in an indexed RIR signature', () => {
    const rows = groupRows(positionPieces(trackingPage(1, 2, 'setRir').map(piece =>
      piece.str === 'SET 2 RIR' ? { ...piece, str: 'SET 1 RIR' } : piece)));
    expect(findTrackingTables(rows)).toHaveLength(0);
  });

  it('does not accept duplicate Early Set RPE labels without a Last Set RPE', () => {
    const rows = groupRows(positionPieces(trackingPage(1, 2, 'rpe').map(piece =>
      piece.str === 'Last Set RPE' ? { ...piece, str: 'Early Set RPE' } : piece)));
    expect(findTrackingTables(rows)).toHaveLength(0);
  });

  it('does not accept more than four tracking sets', () => {
    const rows = groupRows(positionPieces(trackingPage(1, 5)));
    expect(findTrackingTables(rows)).toHaveLength(0);
  });

  it('keeps vertically separated tracking tables from sharing anchor rows', () => {
    const first = trackingPage(1, 2, 'rir');
    const second = trackingPage(1, 2, 'rir').map(piece => {
      const transform = [...piece.transform];
      transform[5] -= 500;
      return { ...piece, transform };
    });
    const rows = groupRows(positionPieces([...first, ...second]));
    const tables = findTrackingTables(rows);

    expect(tables).toHaveLength(2);
    expect(tables.map(table => table.anchors)).toHaveLength(2);
    expect(tables.every(table => table.anchors.length === 1)).toBe(true);
  });
});
