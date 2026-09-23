import {
  columnIndex, fontSize, median, normalizedText, pieceCenter, ROW_TOLERANCE,
  type PositionedPiece, type TextRow
} from './pdfGeometry';

export type TrackingColumn = { center: number; label: string; role: string };
export type TrackingTable = {
  columns: TrackingColumn[];
  headerTop: number;
  headerBottom: number;
  anchors: TextRow[];
  bottom: number;
};
export type RenderedLine = { y: number; x: number; text: string };

function layoutTextSize(pieces: PositionedPiece[]): number {
  return median(pieces.map(piece => Math.max(fontSize(piece), piece.height ?? 0,
    (piece.width ?? 0) / Math.max(1, piece.str.length) * 1.8)));
}

function labelCenter(pieces: PositionedPiece[]): number {
  return (Math.min(...pieces.map(piece => piece.x)) + Math.max(...pieces.map(piece => piece.endX))) / 2;
}

function isRpePair(columns: { label: string }[]): boolean {
  return columns.length === 2 && columns.some(column => column.label === 'Early Set RPE')
    && columns.some(column => column.label === 'Last Set RPE');
}

function findEffortRpeColumns(band: PositionedPiece[]): { center: number; label: string; role: string }[] {
  const direct = band.flatMap(piece => {
    const text = normalizedText(piece.str).toLowerCase();
    if (/^(?:early set rpe|early rpe)$/.test(text)) return [{ center: pieceCenter(piece), label: 'Early Set RPE', role: 'effort' }];
    if (/^(?:last set rpe|last rpe)$/.test(text)) return [{ center: pieceCenter(piece), label: 'Last Set RPE', role: 'effort' }];
    return [];
  });
  if (isRpePair(direct)) return direct.sort((a, b) => a.center - b.center);

  const rows = new Map<number, PositionedPiece[]>();
  const fragments = band.filter(piece => /^(?:early|last|set|rpe|early set|last set)$/i.test(normalizedText(piece.str)));
  for (const piece of fragments) {
    const key = Math.round(piece.y / ROW_TOLERANCE) * ROW_TOLERANCE;
    rows.set(key, [...(rows.get(key) ?? []), piece]);
  }
  const sameRowLabels = [...rows.values()].flatMap(row => {
    const groups: PositionedPiece[][] = [];
    for (const piece of [...row].sort((a, b) => a.x - b.x)) {
      const previous = groups.at(-1);
      const gap = previous ? piece.x - Math.max(...previous.map(item => item.endX)) : Infinity;
      if (previous && gap <= Math.max(fontSize(piece), ...previous.map(fontSize)) * 0.75) previous.push(piece);
      else groups.push([piece]);
    }
    return groups.map(group => ({
      group,
      text: group.map(piece => normalizedText(piece.str)).join(' ').toLowerCase(),
      center: labelCenter(group),
      y: group[0].y
    }));
  });
  const labels = sameRowLabels.flatMap(fragment => {
    if (/^(?:early set rpe|early rpe)$/.test(fragment.text))
      return [{ center: fragment.center, label: 'Early Set RPE', role: 'effort' }];
    if (/^(?:last set rpe|last rpe)$/.test(fragment.text))
      return [{ center: fragment.center, label: 'Last Set RPE', role: 'effort' }];
    if (!/^(?:early set|last set|early|last)$/.test(fragment.text)) return [];

    const rpe = sameRowLabels.filter(candidate => candidate.text === 'rpe'
      && Math.abs(candidate.y - fragment.y) <= Math.max(fontSize(fragment.group[0]), fontSize(candidate.group[0])) * 3
      && Math.abs(candidate.center - fragment.center) <= Math.max(fontSize(fragment.group[0]), fontSize(candidate.group[0])) * 3)
      .sort((left, right) => Math.abs(left.y - fragment.y) + Math.abs(left.center - fragment.center)
        - Math.abs(right.y - fragment.y) - Math.abs(right.center - fragment.center))[0];
    if (!rpe) return [];
    const early = fragment.text.startsWith('early');
    return [{ center: (fragment.center + rpe.center) / 2, label: early ? 'Early Set RPE' : 'Last Set RPE', role: 'effort' }];
  });
  return isRpePair(labels) ? labels.sort((a, b) => a.center - b.center) : [];
}

function hasEverySetIndex(columns: { set: number }[], setCount: number): boolean {
  return columns.length === setCount && new Set(columns.map(column => column.set)).size === setCount
    && columns.every(column => column.set >= 1 && column.set <= setCount);
}

function findRirColumns(band: PositionedPiece[], setCount: number): { center: number; label: string; role: string; set: number }[] {
  const columns = band.flatMap(piece => {
    const value = normalizedText(piece.str);
    const setRir = value.match(/^SET\s+(\d+)\s+RIR$/i);
    const rirSet = value.match(/^RIR\s*\(\s*SET\s+(\d+)\s*\)$/i);
    const match = setRir ?? rirSet;
    return match ? [{ center: pieceCenter(piece), label: `RIR Set ${match[1]}`, role: 'effort', set: Number(match[1]) }] : [];
  });
  if (hasEverySetIndex(columns, setCount)) return columns.sort((a, b) => a.center - b.center);

  const rirTokens = band.filter(piece => /^RIR$/i.test(normalizedText(piece.str))).sort((a, b) => pieceCenter(a) - pieceCenter(b));
  const setLabels = band.flatMap(piece => {
    const match = normalizedText(piece.str).match(/^\(?SET\s+(\d+)\)?$/i);
    return match ? [{ piece, set: Number(match[1]) }] : [];
  });
  const indexed = rirTokens.flatMap(rir => {
    const closest = setLabels.map(label => ({
      ...label,
      distance: Math.abs(pieceCenter(label.piece) - pieceCenter(rir)),
      verticalDistance: Math.abs(label.piece.y - rir.y)
    })).filter(label => label.verticalDistance <= Math.max(fontSize(rir), fontSize(label.piece)) * 3
      && label.distance <= Math.max(fontSize(rir), fontSize(label.piece)) * 3)
      .sort((a, b) => a.distance + a.verticalDistance - b.distance - b.verticalDistance)[0];
    return closest ? [{ center: pieceCenter(rir), label: `RIR Set ${closest.set}`, role: 'effort', set: closest.set }] : [];
  });
  if (hasEverySetIndex(indexed, setCount)) {
    return indexed.sort((a, b) => a.center - b.center);
  }
  return rirTokens.length === setCount
    ? rirTokens.map((piece, index) => ({ center: pieceCenter(piece), label: `RIR Set ${index + 1}`, role: 'effort', set: index + 1 }))
    : [];
}

function parseNumber(value: string | undefined): boolean {
  return !!value && /^(?:\d+(?:\.\d+)?|N\/A)$/i.test(normalizedText(value));
}

function parseEffort(value: string | undefined): boolean {
  return parseNumber(value) || (!!value && /^\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?$/.test(normalizedText(value)));
}

function parseRepRange(value: string | undefined): boolean {
  return !!value && /^(?:\d+(?:\s*[-–]\s*\d+)?|N\/A)$/i.test(normalizedText(value));
}

function isRest(value: string | undefined): boolean {
  return !!value && /^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:min|mins|minutes?|sec|secs|seconds?|s|m)$/i.test(normalizedText(value));
}

/// A row states its set count and rest beside its rep range or effort. A rep cell may wrap around
/// the baseline ("10 per / leg"), so either is enough; and the first movement of a superset rests
/// "-" before its partner, which still leaves the row its rep range.
function hasRowPrescription(row: TextRow, columns: TrackingColumn[]): boolean {
  const reps = hasRoleValue(row, 'repRange', columns, parseRepRange);
  const effort = columns.some(column => column.role === 'effort' && hasRoleValue(row, 'effort', columns, parseEffort));
  const rest = hasRoleValue(row, 'rest', columns, isRest);
  const restsIntoPartner = reps && hasRoleValue(row, 'rest', columns, value => !!value && /^[-–]$/.test(normalizedText(value)));
  return (reps || effort) && (rest || restsIntoPartner);
}

function hasRoleValue(row: TextRow, role: string, columns: TrackingColumn[], predicate: (value: string | undefined) => boolean): boolean {
  const centers = columns.map(column => column.center);
  return row.items.some(piece => {
    const index = columnIndex(pieceCenter(piece), centers);
    return columns[index]?.role === role && predicate(piece.str);
  });
}

function findHeaderBand(parent: PositionedPiece, rows: TextRow[]): PositionedPiece[] {
  const orderedRows = rows.filter(row => row.y <= parent.y + ROW_TOLERANCE).sort((a, b) => b.y - a.y);
  const parentIndex = orderedRows.findIndex(row => row.items.includes(parent));
  if (parentIndex < 0) return [];
  const bandRows = [orderedRows[parentIndex]];
  const rowGaps: number[] = [];
  for (const row of orderedRows.slice(parentIndex + 1)) {
    const previous = bandRows.at(-1)!;
    const gap = previous.y - row.y;
    const sortedGaps = [...rowGaps].sort((a, b) => a - b);
    const expectedGap = sortedGaps[Math.floor(Math.max(0, sortedGaps.length - 1) * 0.8)] ?? 0;
    if (rowGaps.length >= 3 && gap > expectedGap * 2.6) break;
    bandRows.push(row);
    rowGaps.push(gap);
  }
  return bandRows.flatMap(row => row.items);
}

function makeTable(parent: PositionedPiece, rows: TextRow[], lowerBound: number): TrackingTable | undefined {
  const band = findHeaderBand(parent, rows);
  const text = band.map(piece => normalizedText(piece.str));
  const exact = (value: string) => band.filter(piece => normalizedText(piece.str).toLowerCase() === value.toLowerCase());
  const exercise = exact('Exercise')[0];
  const technique = exact('Technique')[0];
  const lastSet = band.find(piece => /^last-set intensity$/i.test(normalizedText(piece.str)));
  const warmup = exact('Warm-up')[0];
  const working = exact('WORKING')[0];
  const rep = exact('Rep')[0];
  const range = exact('Range')[0];
  const loads = exact('LOAD').sort((a, b) => pieceCenter(a) - pieceCenter(b));
  const trackedReps = exact('REPS').sort((a, b) => pieceCenter(a) - pieceCenter(b));
  const rirGroups = findRirColumns(band, loads.length);
  const rpe = findEffortRpeColumns(band);
  const efforts = rpe.length === 2 ? rpe : rirGroups.map((effort, index) => ({
    center: effort.center,
    label: effort.set ? effort.label : `RIR Set ${index + 1}`,
    role: 'effort'
  }));
  const rest = exact('Rest')[0];
  const option1 = exact('Option 1')[0];
  const option2 = exact('Option 2')[0];
  const notes = exact('NOTES')[0];
  const setLabels = band.filter(piece => /^sets?$/i.test(normalizedText(piece.str)));
  const warmupSets = warmup && setLabels.length > 0
    ? [...setLabels].sort((a, b) => Math.abs(pieceCenter(a) - pieceCenter(warmup)) - Math.abs(pieceCenter(b) - pieceCenter(warmup)))[0]
    : undefined;
  const workingSets = working && setLabels.length > 0
    ? [...setLabels].sort((a, b) => Math.abs(pieceCenter(a) - pieceCenter(working)) - Math.abs(pieceCenter(b) - pieceCenter(working)))[0]
    : undefined;
  const setCount = loads.length;
  const repRange = rep && range ? { center: (pieceCenter(rep) + pieceCenter(range)) / 2, label: 'Rep Range', role: 'repRange' } : undefined;
  if (!exercise || !technique || !lastSet || !warmup || !working || !repRange || !warmupSets || !workingSets
    || setCount < 2 || setCount > 4 || trackedReps.length !== setCount
    || (rirGroups.length !== setCount && rpe.length !== 2) || !rest || !option1 || !option2 || !notes
    || !text.some(value => /substitution/i.test(value))) return undefined;

  const loadColumns = loads.flatMap((load, index) => [
    { center: pieceCenter(load), label: `Tracking Load Set ${index + 1}`, role: 'tracking' },
    { center: pieceCenter(trackedReps[index]), label: `Tracking Reps Set ${index + 1}`, role: 'tracking' }
  ]);
  const columns = [
    { center: pieceCenter(exercise), label: 'Exercise', role: 'exercise' },
    { center: (pieceCenter(lastSet) + pieceCenter(technique)) / 2, label: 'Last-Set Intensity Technique', role: 'technique' },
    { center: (pieceCenter(warmup) + pieceCenter(warmupSets)) / 2, label: 'Warm-up Sets', role: 'warmup' },
    { center: (pieceCenter(working) + pieceCenter(workingSets)) / 2, label: 'Working Sets', role: 'working' },
    repRange,
    ...loadColumns,
    ...efforts,
    { center: pieceCenter(rest), label: 'Rest', role: 'rest' },
    { center: pieceCenter(option1), label: 'Substitution Option 1', role: 'substitution' },
    { center: pieceCenter(option2), label: 'Substitution Option 2', role: 'substitution' },
    { center: pieceCenter(notes), label: 'Notes', role: 'notes' }
  ].sort((a, b) => a.center - b.center);
  if (columns.some((column, index) => index > 0 && column.center <= columns[index - 1].center)) return undefined;

  const headerTop = Math.max(...band.map(piece => piece.y));
  const headerBottom = Math.min(...band.map(piece => piece.y));
  const fontThreshold = layoutTextSize(band);
  const anchors = rows.filter(row => row.y < headerBottom - fontThreshold && row.y > lowerBound + ROW_TOLERANCE
    && hasRoleValue(row, 'working', columns, value => !!value && /^\d{1,2}$/.test(normalizedText(value)))
    && hasRowPrescription(row, columns))
    .sort((a, b) => b.y - a.y);
  if (anchors.length === 0) return undefined;
  const rowGaps = anchors.slice(1).map((row, index) => anchors[index].y - row.y).filter(gap => gap > 0);
  const padding = Math.max(ROW_TOLERANCE * 4, median(rowGaps) > 0 ? median(rowGaps) / 2 : fontThreshold * 4);
  return { columns, headerTop, headerBottom, anchors, bottom: anchors.at(-1)!.y - padding };
}

/// The strict family signature keeps this reconstruction away from unrelated exercise tables.
export function findTrackingTables(rows: TextRow[]): TrackingTable[] {
  const allPieces = rows.flatMap(row => row.items);
  const parents = allPieces.filter(piece => /^tracking load and reps$/i.test(normalizedText(piece.str)))
    .sort((left, right) => right.y - left.y);
  const tables: TrackingTable[] = [];
  for (const [index, parent] of parents.entries()) {
    const table = makeTable(parent, rows, parents[index + 1]?.y ?? Number.NEGATIVE_INFINITY);
    if (table) tables.push(table);
  }
  return tables.sort((a, b) => b.headerTop - a.headerTop);
}

function tableColumnIndex(item: PositionedPiece, columns: TrackingColumn[], textSize: number): number {
  const centers = columns.map(column => column.center);
  const index = columnIndex(pieceCenter(item), centers);
  const notesIndex = columns.length - 1;
  const secondSubstitutionIndex = notesIndex - 1;
  if (index === secondSubstitutionIndex && item.x > centers[secondSubstitutionIndex] + textSize * 5) return notesIndex;
  return index;
}

export function renderTrackingTables(rows: TextRow[], tables: TrackingTable[]): RenderedLine[] {
  const rendered: RenderedLine[] = [];
  for (const table of tables) {
    const { columns, headerTop, headerBottom, anchors, bottom } = table;
    const tableSize = layoutTextSize(rows.flatMap(row => row.items));
    rendered.push({ y: headerTop, x: 0, text: columns.map(column => column.label).join(' | ') });
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const upper = index === 0 ? (headerBottom + anchor.y) / 2 : (anchors[index - 1].y + anchor.y) / 2;
      const lower = index === anchors.length - 1 ? bottom : (anchor.y + anchors[index + 1].y) / 2;
      const cells = columns.map(() => [] as string[]);
      const block = rows.filter(row => row.y <= upper && row.y >= lower).flatMap(row => row.items);
      for (const item of block) {
        // A left-aligned note's short closing line ("the pecs.") centers far left of its cell;
        // it belongs to the column of the widest line that starts where it starts.
        const widest = block.filter(other => Math.abs(other.x - item.x) <= 1)
          .reduce((best, other) => other.endX - other.x > best.endX - best.x ? other : best, item);
        cells[tableColumnIndex(widest, columns, tableSize)].push(normalizedText(item.str));
      }
      const line = cells.map(cell => cell.join(' ').replace(/\s+/g, ' ').trim()).join(' | ');
      if (line.replace(/[|\s]/g, '')) rendered.push({ y: anchor.y, x: 0, text: line });
    }
  }
  return rendered;
}

export function isInTrackingTable(row: TextRow, table: TrackingTable): boolean {
  return row.y <= table.headerTop + 4 && row.y >= table.bottom;
}

export function isTrackingHeaderPiece(piece: PositionedPiece, table: TrackingTable): boolean {
  return piece.y <= table.headerTop + 4 && piece.y >= table.headerBottom;
}
