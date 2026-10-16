import type { ImportProgressDetails, ImportView } from '../types';

export type SectionState = 'committed' | 'saved' | 'checking' | 'repairing' | 'reading' | 'queued';

type ProgressSource = Pick<ImportView, 'stage' | 'chunksDone' | 'chunksTotal'> & { progress?: ImportProgressDetails | null };

/// How far through its own work each state is. A read is the long step, so a section mid-read
/// counts for a little and a section being checked for most of its share; a repair is another read.
const SETTLED: Record<SectionState, number> = {
  committed: 1, saved: 1, checking: 0.85, repairing: 0.55, reading: 0.25, queued: 0
};

/// The furthest a section can honestly get before the server reports its next state: the bar may
/// creep toward this while a read is out, but never past the point the section has not reached.
const CEILING: Record<SectionState, number> = {
  committed: 1, saved: 1, checking: 0.97, repairing: 0.82, reading: 0.78, queued: 0
};

/// One state per section in outline order. Older servers report counts only; their sections are
/// laid out committed first, then the counted states, so the picture still adds up.
export function sectionStates(view: ProgressSource): SectionState[] {
  const total = Math.max(0, view.chunksTotal);
  const reported = view.progress?.sectionStates;
  if (reported && reported.length === total) return reported as SectionState[];
  const progress = view.progress;
  const committed = Math.min(total, view.chunksDone);
  const counts: [SectionState, number][] = [
    ['committed', committed],
    ['saved', Math.max(0, (progress?.sectionsWithResponses ?? committed) - committed - (progress?.sectionsVerifying ?? 0) - (progress?.sectionsRepairing ?? 0))],
    ['checking', progress?.sectionsVerifying ?? 0],
    ['repairing', progress?.sectionsRepairing ?? 0],
    ['reading', progress?.sectionsReading ?? 0]
  ];
  const states = counts.flatMap(([state, count]) => Array<SectionState>(Math.max(0, count)).fill(state)).slice(0, total);
  return [...states, ...Array<SectionState>(total - states.length).fill('queued')];
}

export type ImportProgressEstimate = { percent: number; ceiling: number };

/// The share of the section pass that is done, and the most it may show before the next status
/// arrives. Null where there is nothing to measure: the outline read, a choice waiting on the
/// lifter, and the final check of the assembled program, which stays indeterminate.
export function importProgressEstimate(view: ProgressSource): ImportProgressEstimate | null {
  if (view.stage === 'outline' || view.stage === 'select' || view.chunksTotal <= 0) return null;
  const states = sectionStates(view);
  const finalCheck = view.stage === 'verify' && states.every(state => state === 'committed' || state === 'saved');
  if (finalCheck) return null;
  const share = (weights: Record<SectionState, number>) =>
    Math.min(99, (states.reduce((sum, state) => sum + weights[state], 0) / states.length) * 100);
  const percent = share(SETTLED);
  return { percent, ceiling: Math.max(percent, share(CEILING)) };
}

/// The settled share as a whole percentage, for surfaces that show a single number per poll.
export function estimatedPercent(view: ProgressSource): number | null {
  const estimate = importProgressEstimate(view);
  return estimate ? Math.floor(estimate.percent) : null;
}

export function summarizeSections(states: readonly SectionState[]): Record<SectionState, number> {
  const counts: Record<SectionState, number> = { committed: 0, saved: 0, checking: 0, repairing: 0, reading: 0, queued: 0 };
  for (const state of states) counts[state]++;
  return counts;
}
