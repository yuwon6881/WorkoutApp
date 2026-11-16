/// Why "Accept and create program" is not available yet, in the order the lifter can act on it. A
/// generic "resolve review items" says nothing about which of several things is in the way.

export type ImportAcceptBlockers = {
  saving: boolean;
  saveFailed: boolean;
  /// Review items that need a decision (unlinked movements, conflicts, missing weeks).
  attention: number;
  /// Flagged details the lifter has to confirm once they have looked.
  uncertain: number;
  uncertainConfirmed: boolean;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/// The single next step, or undefined when nothing blocks.
export function importAcceptHint(blockers: ImportAcceptBlockers): string | undefined {
  if (blockers.saveFailed) return 'Your last edit did not save. Retry the save to continue.';
  if (blockers.saving) return 'Saving your edits…';
  if (blockers.attention > 0) {
    return `${plural(blockers.attention, 'item needs', 'items need')} your decision before you can create the program.`;
  }
  if (blockers.uncertain > 0 && !blockers.uncertainConfirmed) {
    return `Confirm the ${plural(blockers.uncertain, 'uncertain detail', 'uncertain details')} to continue.`;
  }
  return undefined;
}

/// When what blocks is the review itself, the action slot becomes the way into it ("Review 9 details")
/// instead of a disabled button with an explanation beside it. Undefined while saving or after a failed
/// save, which the lifter cannot fix by reviewing.
export function importReviewActionLabel(blockers: ImportAcceptBlockers): string | undefined {
  if (blockers.saveFailed || blockers.saving) return undefined;
  if (blockers.attention > 0) return `Review ${plural(blockers.attention, 'item', 'items')}`;
  if (blockers.uncertain > 0 && !blockers.uncertainConfirmed) return `Review ${plural(blockers.uncertain, 'detail', 'details')}`;
  return undefined;
}
