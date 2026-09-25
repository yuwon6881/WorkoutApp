using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// The passes that need every section: a week, phase or printed schedule is only whole once
    /// the last section has landed, so they run over the whole draft rather than one section.
    private static ImportDraft FinalizeDraft(ImportDraft merged, List<ImportPageText> sourcePages, AiImport import,
        List<ImportReviewIssue> notices)
    {
        // A week whose lettered versions landed in different sections is
        // only whole now, so it is separated again over the whole draft.
        var versions = ImportWeekVariants.Separate(merged.Workouts, sourcePages);
        merged = merged with { Workouts = versions.Workouts };
        notices.AddRange(versions.Notices);
        var blockRuns = ImportBlockRuns.Reconcile(merged.Workouts);
        merged = merged with { Workouts = blockRuns.Workouts };
        notices.AddRange(blockRuns.Notices);
        var named = ImportDayLabels.FillMissing(merged);
        merged = named.Draft;
        notices.AddRange(named.Notices);
        if (ImportPrintedPhaseWeeks.Read(sourcePages) is { } printedWeeks)
        {
            var placed = printedWeeks.Reconcile(merged.Workouts);
            merged = merged with { ProgramName = ImportPrintedPhaseWeeks.Title,
                Workouts = placed.Workouts };
            notices.AddRange(placed.Notices);
        }
        else if (ImportBeginnerTransformation.Read(sourcePages, import.FileName) is { } beginner)
        {
            var placed = beginner.Reconcile(merged.Workouts);
            merged = merged with { ProgramName = ImportBeginnerTransformation.Title,
                Workouts = placed.Workouts };
            notices.AddRange(placed.Notices);
        }
        // Every section has landed, so the phases are finally whole and their
        // weeks can be numbered from one within each of them.
        var numbered = NormalizePhaseWeeks(merged.Workouts);
        if (numbered.Renumbered)
        {
            merged = merged with { Workouts = numbered.Workouts };
            notices.Add(new ImportReviewIssue("phase_week_renumbered",
                "Some phases continued the block's week numbering, so their weeks were numbered from one within each phase. The weeks themselves are unchanged.",
                "info", null));
        }
        var longWeeks = ImportLongWeeks.Reconcile(merged.Workouts, sourcePages);
        merged = merged with { Workouts = longWeeks.Workouts, SourceWeekDays = longWeeks.SourceWeekDays };
        notices.AddRange(longWeeks.Notices);
        merged = ApplyPrintedSchedule(merged, sourcePages, notices);
        // The whole draft is shaped again, not just this section's days: a day
        // an earlier section committed before this ran is exactly the one that
        // no retry of the last section could ever reach.
        var shaped = ReconcileDayShape(merged.Workouts, merged.SourceWeekDays);
        var cited = ImportDayShape.ReconcilePages(merged with { Workouts = shaped.Workouts }, import.Pages);
        merged = ImportValidation.NormalizeDraft(ImportNameSpelling.Standardize(cited.Draft, sourcePages));
        if (ImportTableEvidence.PrintedRowsNotice(merged.Workouts, ImportSourceText.Slice(sourcePages, 1, ImportSourceText.MaxPages)) is { } printedRows)
            notices.Add(printedRows);
        notices.AddRange(shaped.Notices);
        notices.AddRange(cited.Notices);
        return merged;
    }

    /// A complete printed schedule places every day in its printed week and slot, and a rest day
    /// wherever a band prints one. A long printed week keeps its length as the confirmed one.
    private static ImportDraft ApplyPrintedSchedule(ImportDraft draft, IReadOnlyList<ImportPageText> pages, List<ImportReviewIssue> notices)
    {
        if (ImportPrintedSchedule.Read(pages) is not { } schedule) return draft;
        var placed = schedule.Reconcile(draft.Workouts);
        notices.AddRange(placed.Notices);
        if (placed.Workouts is not { } workouts) return draft;
        // Measured on the printed schedule alone: a warm-up day read in front of it is no printed slot.
        var longest = schedule.Days.GroupBy(day => day.Week).Max(week => week.Count() + week.Sum(day => day.RestsAfter));
        return draft with { Workouts = workouts, SourceWeekDays = longest > 7 ? Math.Max(longest, draft.SourceWeekDays ?? 0) : draft.SourceWeekDays };
    }
}
