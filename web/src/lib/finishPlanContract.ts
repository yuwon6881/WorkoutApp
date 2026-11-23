export type FinishPlanUpdateInput = {
  scope: 'block' | 'program'; changesHash: string; programRevision: number; dayRevisions: Record<string, number>;
};
export type FinishPlanEdit = { name: string; changes?: string[]; occurrences?: number | null };

export type FinishPlanPreview = Omit<FinishPlanUpdateInput, 'scope'> & {
  edits: FinishPlanEdit[]; counts: { block: number; program: number }; changes: string[];
};
