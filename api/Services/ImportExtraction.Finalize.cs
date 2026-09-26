using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// A fully read draft is ready for review, unless the document prints a week in versions to
    /// run only one of: then it waits for that choice, with every version's days still held.
    private void CompleteRead(AiImport import, ImportDraft draft, IReadOnlyList<ImportPageText> pages)
    {
        var choices = ImportWeekChoice.Offer(draft, pages);
        if (choices.Count > 1)
        {
            import.AlternativesJson = Json.Write(choices);
            import.SelectedAlternativeId = "";
            import.Stage = "select"; import.Status = ImportStatus.Pending;
        }
        else
        {
            import.Status = ImportStatus.Ready; import.Stage = "done";
            import.DraftBaselineJson = Json.Write(draft);
        }
        UpdateCounters(import, draft);
    }

    /// Keeps the chosen week version and makes the draft ready for review.
    private void ChooseWeekVersion(AiImport import, ImportAlternative chosen, IReadOnlyList<ImportAlternative> offered)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(import.DraftJson), "This import has no draft to choose from. Read the PDF again.", 409);
        var draft = ImportValidation.NormalizeDraft(ImportWeekChoice.Apply(Json.Read<ImportDraft>(import.DraftJson), chosen, offered));
        // The notice that both versions were kept as weeks of their own no longer describes the draft.
        var notices = ReadNotices(import.NoticesJson).Where(notice => notice.Code != ImportWeekVariants.Code).ToList();
        import.NoticesJson = Json.Write(ImportReviewNotices.Merge(notices, [ImportWeekChoice.ChosenNotice(chosen, offered)]));
        import.DraftJson = Json.Write(draft);
        import.DraftBaselineJson = import.DraftJson;
        import.SelectedAlternativeId = chosen.Id;
        import.Status = ImportStatus.Ready; import.Stage = "done";
        UpdateCounters(import, draft);
    }

    /// The passes that need every section: a week, phase or printed schedule is only whole once
    /// the last section has landed, so they run over the whole draft rather than one section.
    private static ImportDraft FinalizeDraft(ImportDraft merged, List<ImportPageText> sourcePages, AiImport import,
        List<ImportReviewIssue> notices)
    {
        var routine = ImportWarmupRoutine.LeaveOut(merged.Workouts, sourcePages);
        merged = merged with { Workouts = routine.Workouts };
        notices.AddRange(routine.Notices);
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
