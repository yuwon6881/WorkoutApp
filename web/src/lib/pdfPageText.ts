import {
  associateDayLabels, besideTable, dayLabelLine, findDayTitles, findStackedLabels, labelPieces, placeStackedLabels,
  type DayLabel, type TableSpan
} from './pdfDayLabels';
import { findHeaderBands, renderRow, type HeaderBand } from './pdfHeaderColumns';
import { anchorColumn, anchorsRow, renderHeaderTable } from './pdfTableRows';
import { withExerciseColumn } from './pdfExerciseColumn';
import {
  estimateFallbackColumnGap, estimateTableRegionGap, groupRows, normalizedText,
  positionPieces, ROW_TOLERANCE, type TextPiece, type TextRow
} from './pdfGeometry';
import { findTrackingTables, isInTrackingTable, renderTrackingTables, type TrackingTable } from './pdfTrackingTable';


function isScheduleLabel(value: string): boolean {
  return /^(?:BLOCK\s+\d+(?:\s*:\s*.*)?|\(BLOCK\s+\d+\)|WEEK\s+\d+[A-Z]?|INTRO\s+WEEK|DELOAD\s+WEEK|(?:\d(?:\s*[-–]\s*\d)?\s+)?(?:SUGGESTED\s+|MANDATORY\s+|OPTIONAL\s+)?REST\s+DAYS?)$/i.test(normalizedText(value));
}

function withoutLabels(rows: TextRow[], removed: Set<TextPiece>): TextRow[] {
  return rows.map(row => ({ ...row, items: row.items.filter(item => !removed.has(item)) }));
}

function tableSpanForTracking(table: TrackingTable): TableSpan {
  return { top: table.headerTop, headerBottom: table.headerBottom, bottom: table.bottom, left: table.columns[0]?.center,
    right: table.columns.at(-1)?.center };
}

function tableSpanForHeader(rows: TextRow[], band: HeaderBand, tableRegionGap: number, nextBandTop?: number): TableSpan {
  let bottom = band.bottomY;
  let previousY = band.bottomY;
  const laterRows = rows.filter(row => row.y < band.bottomY && (nextBandTop === undefined || row.y > nextBandTop))
    .sort((a, b) => b.y - a.y);
  const anchor = anchorColumn(band);
  // Padded tables leave more space between two rows than between a cell's wrapped lines, so a
  // wide gap ends the table only when the lines after it hold no further set count. A footer or
  // a note below the table carries none and stays out.
  const nextClusterAnchors = (start: number): boolean => {
    if (anchor === undefined) return false;
    for (let index = start; index < laterRows.length; index++) {
      if (index > start && laterRows[index - 1].y - laterRows[index].y > tableRegionGap) return false;
      if (anchorsRow(laterRows[index], band, anchor)) return true;
    }
    return false;
  };
  const wideGap = Math.max(tableRegionGap * 3, 80);
  let first = true;
  for (let index = 0; index < laterRows.length; index++) {
    const gap = previousY - laterRows[index].y;
    const allowedGap = first ? wideGap : tableRegionGap;
    if (gap > allowedGap && !(gap <= wideGap && nextClusterAnchors(index))) break;
    bottom = laterRows[index].y;
    previousY = bottom;
    first = false;
  }
  const exerciseColumn = band.columns?.find(column => /^(?:exercises?|movement|(?:exercise )?name)$/i.test(column.label.trim()));
  return { top: band.topY, headerBottom: band.bottomY, bottom,
    left: exerciseColumn?.center ?? band.centers[0], right: band.centers.at(-1) };
}

function nearestTable(label: DayLabel, spans: TableSpan[]): { index: number; distance: number } {
  return spans.map((span, index) => ({
    index,
    distance: label.bottom > span.top ? label.bottom - span.top
      : label.top < span.bottom ? span.bottom - label.top : 0
  })).sort((a, b) => a.distance - b.distance)[0] ?? { index: -1, distance: Number.POSITIVE_INFINITY };
}

function labelNearTable(label: DayLabel, labels: DayLabel[], spans: TableSpan[]): boolean {
  const nearest = nearestTable(label, spans);
  if (nearest.distance > 200) return false;
  return !labels.some(other => other !== label && nearestTable(other, spans).index === nearest.index
    && nearestTable(other, spans).distance < nearest.distance - ROW_TOLERANCE);
}

/// Vocabulary words such as BACK and CHEST can be the first word of an exercise name. A horizontal
/// title can sit beside a table or above it, but a word inside its exercise column is row content.
function labelIsInsideExerciseColumn(label: DayLabel, spans: TableSpan[]): boolean {
  // The fallback vocabulary also accepts complete titles such as "Upper 2" or "Full Body 5".
  // Only a lone word can be the first exercise-name cell this filter is meant to discard.
  if (/\s/.test(label.text.trim())) return false;
  const right = Math.max(...label.pieces.map(piece => piece.endX));
  return spans.some(span => span.left !== undefined && span.headerBottom !== undefined
    && label.top < span.headerBottom - ROW_TOLERANCE
    && label.top > span.bottom + ROW_TOLERANCE && right >= span.left);
}

function isGeneralWarmupPage(rows: TextRow[]): boolean {
  return rows.some(row => /^(?:THE\s+)?(?:GENERAL\s+WARM.?UP|WARM.?UP\s+PROTOCOL|SPECIFIC\s+PYRAMID\s+WARM.?UP)\b/i
    .test(normalizedText(row.items.map(item => item.str).join(' '))));
}

function scheduleLines(rows: TextRow[]): { y: number; x: number; text: string }[] {
  return rows.flatMap(row => row.items.filter(item => isScheduleLabel(item.str))
    .map(item => ({ y: item.y, x: item.x, text: normalizedText(item.str) })));
}

type TableLayout = {
  genericRows: TextRow[];
  headerTableSpans: { band: HeaderBand; span: TableSpan }[];
  tableSpans: TableSpan[];
};

/// Where a page's tables are once its day titles and schedule banners are set aside.
function tableLayout(rows: TextRow[], trackingTables: TrackingTable[], removed: Set<TextPiece>, fallbackGap: number): TableLayout {
  const genericRows = withoutLabels(rows, removed).filter(row => row.items.length > 0
    && !trackingTables.some(table => isInTrackingTable(row, table)));
  const bands = findHeaderBands(genericRows, fallbackGap / 2.35);
  const headerBands = bands.map((band, index) => withExerciseColumn(band, genericRows, removed, bands[index + 1]?.topY));
  const tableRegionGap = estimateTableRegionGap(genericRows);
  const headerTableSpans = headerBands.map((band, index) => ({
    band,
    span: tableSpanForHeader(genericRows, band, tableRegionGap, headerBands[index + 1]?.topY)
  }));
  const tableSpans = [
    ...trackingTables.map(tableSpanForTracking),
    ...headerTableSpans.map(item => item.span)
  ];
  return { genericRows, headerTableSpans, tableSpans };
}

/// Rebuilds page text in reading order. Geometry, header bands, day labels, and the strict
/// tracking-table family each own a focused pass so their heuristics stay independently testable.
export function buildPageText(items: readonly TextPiece[]): string {
  const positioned = positionPieces(items);
  const rows = groupRows(positioned);
  const generalWarmupPage = isGeneralWarmupPage(rows);
  const fallbackGap = estimateFallbackColumnGap(rows);
  const trackingTables = findTrackingTables(rows);
  const { labels: markedDayLabels, superseded } = findDayTitles(positioned);
  const schedulePieces = new Set<TextPiece>([...superseded, ...rows.flatMap(r => r.items.filter(item => isScheduleLabel(item.str)))]);
  const layoutWithout = (labels: DayLabel[]) => tableLayout(rows, trackingTables,
    new Set([...labelPieces(labels) as Set<TextPiece>, ...schedulePieces]), fallbackGap);
  // A stacked margin title is only a title beside a table, and a table is only found once the
  // stack's words are out of its rows, so the stacks are tried first and kept where they fit. A
  // stack may start with a word the vocabulary already marked ("FULL BODY" over "5 (PUMP DAY)"),
  // so only rotated titles are off limits to it.
  const rotatedTitles = markedDayLabels.filter(label => label.pieces.some(piece => piece.rotated));
  const stacked = findStackedLabels(positioned, labelPieces(rotatedTitles));
  const withStacks = (stacks: DayLabel[]) => {
    const stackPieces = labelPieces(stacks);
    return [...markedDayLabels.filter(label => !label.pieces.some(piece => stackPieces.has(piece))), ...stacks];
  };
  let selectedLabels = withStacks(stacked);
  let layout = layoutWithout(selectedLabels);
  let stackedTitles = stacked.filter(label => besideTable(label, layout.tableSpans));
  if (stackedTitles.length < stacked.length) {
    selectedLabels = withStacks(stackedTitles);
    layout = layoutWithout(selectedLabels);
  }
  if (generalWarmupPage) {
    stackedTitles = [];
    const explicit = selectedLabels.filter(label => label.pieces.some(piece => piece.rotated));
    if (explicit.length !== selectedLabels.length) {
      selectedLabels = explicit;
      layout = layoutWithout(selectedLabels);
    }
  }
  // Horizontal words like CHEST and BACK appear as volume-chart rows and prose headings. A
  // workout title on those pages has no exercise table to anchor it, so keep horizontal labels
  // only when this page contains a recognized schedule table. Rotated margin tabs remain explicit
  // source evidence even on layouts whose table headers are not readable.
  if (layout.headerTableSpans.length === 0 && trackingTables.length === 0) {
    const anchored = selectedLabels.filter(label => label.pieces.some(piece => piece.rotated));
    if (anchored.length !== selectedLabels.length) {
      selectedLabels = anchored;
      layout = layoutWithout(selectedLabels);
    }
  }
  const stackPieces = labelPieces(stackedTitles);
  const outsideExerciseColumn = selectedLabels.filter(label => label.pieces.some(piece => piece.rotated)
    || label.pieces.some(piece => stackPieces.has(piece)) || !labelIsInsideExerciseColumn(label, layout.tableSpans));
  if (outsideExerciseColumn.length !== selectedLabels.length) {
    selectedLabels = outsideExerciseColumn;
    layout = layoutWithout(selectedLabels);
  }
  const nearTable = selectedLabels.filter(label => label.pieces.some(piece => piece.rotated)
    || label.pieces.some(piece => stackPieces.has(piece)) || labelNearTable(label, selectedLabels, layout.tableSpans));
  if (nearTable.length !== selectedLabels.length) {
    selectedLabels = nearTable;
    layout = layoutWithout(selectedLabels);
  }
  const { genericRows, headerTableSpans, tableSpans } = layout;
  const dayLabels = [
    ...associateDayLabels(selectedLabels.filter(label => !label.pieces.some(piece => stackPieces.has(piece))), tableSpans),
    ...placeStackedLabels(stackedTitles, tableSpans)
  ];
  const lines: { y: number; x: number; text: string }[] = [
    ...scheduleLines(rows),
    ...dayLabels.map(label => ({ y: label.y, x: label.x, text: dayLabelLine(label) })),
    // A rotated day tab beside a tracking table is its title, not the first word of a movement
    // ("Upper 1 Pull-Up (Wide Grip)").
    ...renderTrackingTables(withoutLabels(rows, new Set([...labelPieces(dayLabels) as Set<TextPiece>, ...schedulePieces])), trackingTables)
  ];

  for (let i = 0; i < headerTableSpans.length; i++) {
    const { band, span } = headerTableSpans[i];
    const nextBand = headerTableSpans[i + 1]?.band;
    lines.push({ y: band.topY, x: band.centers[0] ?? 0, text: band.text });
    const tableRows = genericRows.filter(r => r.y < band.bottomY && r.y >= span.bottom && (!nextBand || r.y > nextBand.topY));
    lines.push(...renderHeaderTable(band, tableRows, span.bottom, fallbackGap));
  }

  const outsideRows = genericRows.filter(row =>
    !headerTableSpans.some(({ band, span }, i) => {
      const nextBand = headerTableSpans[i + 1]?.band;
      const lower = nextBand ? Math.max(span.bottom, nextBand.topY) : span.bottom;
      return row.y <= band.topY && row.y >= lower;
    })
  );
  for (const row of outsideRows) {
    const text = renderRow(row, undefined, fallbackGap);
    if (text) lines.push({ y: row.y, x: row.items[0]?.x ?? 0, text });
  }

  // A vertical block badge may print BLOCK above its number, with a program title between them.
  // Preserve the paired heading so the outline can distinguish successive page templates.
  for (const heading of lines.filter(line => line.text === 'BLOCK')) {
    const number = lines.find(line => /^[1-9]$/.test(line.text)
      && line.y < heading.y - 20 && line.y > heading.y - 80
      && line.x >= heading.x && line.x < heading.x + 100);
    if (number) {
      heading.text = `BLOCK ${number.text}`;
      lines.splice(lines.indexOf(number), 1);
    }
  }
  return lines.sort((a, b) => b.y - a.y || a.x - b.x).map(line => line.text).join('\n');
}
