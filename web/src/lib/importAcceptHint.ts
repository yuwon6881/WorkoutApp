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
