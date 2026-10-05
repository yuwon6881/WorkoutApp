export type FinishPlanUpdateInput = {
  scope: 'block' | 'program'; changesHash: string; programRevision: number; dayRevisions: Record<string, number>;
};
export type FinishPlanPreview = Omit<FinishPlanUpdateInput, 'scope'> & {
  edits: { name: string }[]; counts: { block: number; program: number }; changes: string[];
};
