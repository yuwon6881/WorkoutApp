import type { ImportDraft, ImportView } from '../types';
import { importIssueCopy } from './importIssueCopy';

/// Where in the draft an issue points, so the outline can scroll to and open it.
export type ImportIssueTarget = {
  sourcePage?: number | null;
  workoutLineId?: string | null;
  exerciseLineId?: string | null;
  setIndex?: number | null;
  targetField?: string | null;
};

/// One thing the lifter must settle before the program can be created.
export type AttentionRow = {
  key: string;
  title: string;
  message: string | null;
  detail: string;
  action: string;
  ariaLabel: string;
  target: ImportIssueTarget;
};

/// Unmapped exercises first, then every review issue that is more than a note.
export function buildAttentionRows(view: ImportView, draft: ImportDraft | null): AttentionRow[] {
  const unresolvedTarget = (lineId: string): ImportIssueTarget => {
    const day = draft?.workouts.find(candidate => candidate.exercises.some(exercise => exercise.lineId === lineId));
    return { workoutLineId: day?.lineId, exerciseLineId: lineId, targetField: 'library' };
  };
  return [
    ...view.unresolved.map(item => ({
      key: `unresolved-${item.lineId}`,
      title: `Map ${item.sourceName}`,
      message: null,
      detail: `${item.block ? `${item.block} · ` : ''}${item.occurrences && item.occurrences > 1 ? `${item.occurrences} occurrences · ` : ''}Choose a library exercise for this slot.`,
      action: 'Map',
      ariaLabel: `Fix unmapped exercise ${item.sourceName}`,
      target: unresolvedTarget(item.lineId)
    })),
    ...(view.reviewIssues ?? []).filter(issue => issue.severity !== 'info').map((issue, index) => ({
      key: `${issue.code}-${index}`,
      title: importIssueCopy(issue.code, issue.message).title,
      message: issue.message,
      detail: `${issue.sourcePage ? `PDF p.${issue.sourcePage} · ` : ''}${importIssueCopy(issue.code, issue.message).hint}`,
      action: 'Fix',
      ariaLabel: `Fix issue: ${issue.message}`,
      target: {
        sourcePage: issue.sourcePage, workoutLineId: issue.workoutLineId, exerciseLineId: issue.exerciseLineId,
        setIndex: issue.setIndex, targetField: issue.targetField
      }
    }))
  ];
}
