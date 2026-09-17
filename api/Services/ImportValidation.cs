using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class ImportValidation
{
    public static List<UnresolvedExercise> Unresolved(ImportDraft draft)
        => draft.Workouts.Where(w => !w.IsRestDay).SelectMany(w => w.Exercises).Where(e => e.ExerciseId == null)
            .Select(e => new UnresolvedExercise(e.LineId, e.SourceName)).ToList();

    public static List<ImportReviewIssue> ReviewIssues(ImportDraft draft)
    {
        var issues = new List<ImportReviewIssue>();
        foreach (var day in draft.Workouts.Where(w => !w.IsRestDay))
        {
            if (day.Weekday is null)
                issues.Add(new ImportReviewIssue("schedule_required", $"{day.Name} has no weekday yet; choose one before activation.", "blocking", day.SourcePage));
            foreach (var set in day.Exercises.SelectMany(e => e.Sets).Where(s => !s.Warmup))
            {
                if (set.TargetRpe is null)
                    issues.Add(new ImportReviewIssue("rpe_unspecified", $"{day.Name} contains a working set without a target RPE; it will remain unspecified.", "warning", set.SourcePage ?? day.SourcePage));
                if (set.RestSeconds is null && string.IsNullOrWhiteSpace(set.RestText))
                    issues.Add(new ImportReviewIssue("rest_unspecified", $"{day.Name} contains a set without a stated rest; it will remain unspecified.", "warning", set.SourcePage ?? day.SourcePage));
            }
        }
        foreach (var phase in GroupDraftPhases(draft.Workouts))
        {
            var weeks = phase.Select(day => day.Week).Distinct().OrderBy(week => week).ToList();
            for (var index = 1; index < weeks.Count; index++)
                if (weeks[index] != weeks[index - 1] + 1)
                    issues.Add(new ImportReviewIssue("phase_week_gap",
                        $"'{phase[0].Phase}' jumps from week {weeks[index - 1]} to week {weeks[index]}; check that nothing is missing.",
                        "warning", phase[0].SourcePage));
        }
        return issues;
    }

    public static async Task ValidateDraft(ImportDraft draft, CatalogService catalog, CancellationToken ct)
    {
        Validation.Name(draft.ProgramName, "Program name");
        Validation.Text(draft.Description, 4000, "Program description");
        Validation.Require(draft.Workouts is { Count: > 0 and <= 400 }, "A program needs between 1 and 400 days.");
        Validation.Require(draft.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        Validation.Require(draft.Workouts.Select(w => w.LineId).Distinct().Count() == draft.Workouts.Count, "A program contains duplicate workout rows.");
        var scheduled = draft.Workouts.Where(w => w.Weekday is not null).Select(w => (w.Week, Weekday: w.Weekday!.Value)).ToList();
        Validation.Require(scheduled.Count == scheduled.Distinct().Count(), "A program contains two workouts on the same weekday in one week.");
        foreach (var phase in GroupDraftPhases(draft.Workouts))
        {
            // Phase weeks count from one inside their phase. Imported drafts are renumbered before
            // they get here, so reaching this with a gap means an edit introduced one.
            var phaseWeeks = phase.Select(w => w.PhaseWeek).Distinct().OrderBy(value => value).ToList();
            Validation.Require(phaseWeeks.Count == 0 || phaseWeeks.Select((value, index) => value == index + 1).All(value => value),
                $"Phase '{phase[0].Phase}' has a missing phase week. Review the outline before accepting it.", 422);
        }
        foreach (var workout in draft.Workouts) await ValidateWorkout(workout, catalog, ct);
    }

    public static async Task ValidateWorkout(DraftWorkout workout, CatalogService catalog, CancellationToken ct)
    {
        Validation.Name(workout.Name, "Workout name");
        Validation.Text(workout.Block, 80, "Block"); Validation.Text(workout.Phase, 120, "Phase");
        Validation.Text(workout.Focus, 120, "Focus"); Validation.Text(workout.Notes, 2000, "Workout notes");
        Validation.Require(workout.PhaseWeek is > 0 and <= 104, "Phase week must be between 1 and 104.");
        Validation.Require(workout.Weekday is null or >= 1 and <= 7, "Workout weekdays must use ISO values from 1 (Monday) to 7 (Sunday).");
        Validation.Require(workout.IsRestDay ? workout.Exercises is { Count: 0 } : workout.Exercises is { Count: > 0 and <= 40 },
            workout.IsRestDay ? "A rest day cannot contain exercises." : "Each workout needs between 1 and 40 exercises.");
        foreach (var exercise in workout.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160); Validation.Text(exercise.Notes, 1000, "Exercise notes");
            Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "Exercise source page is invalid.");
            Validation.Text(exercise.SequenceGroup, 8, "Sequence group"); Validation.Substitutions(exercise.Substitutions);
            // Imported notation is preserved for review, including unusual but valid 1-10
            // target RPE values; manual program editing keeps the stricter training range.
            Validation.Prescriptions(exercise.Sets.Select(ToPrescription).ToList(), false, true);
            foreach (var set in exercise.Sets)
            {
                Validation.Require(set.SourcePage is null || set.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "Set source page is invalid.");
                foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                    Validation.Require(source is "extracted" or "inferred" or "userEdited", "Unknown provenance label.");
            }
            await catalog.RequireActive(exercise.ExerciseId, ct);
        }
    }

    /// Numbers each phase's weeks from one. A document regularly labels a phase — a deload week
    /// most of all — while letting the block's week counter run on, so the phase arrives as "week
    /// five of one week". That is a numbering convention, not a missing week: the phase's real
    /// order is its absolute weeks, which are left exactly as the document stated them.
    public static (List<DraftWorkout> Workouts, bool Renumbered) NormalizePhaseWeeks(List<DraftWorkout> workouts)
    {
        var mapped = new Dictionary<Guid, int>();
        foreach (var phase in GroupDraftPhases(workouts))
        {
            var order = phase.Select(day => day.PhaseWeek).Distinct().OrderBy(week => week)
                .Select((week, index) => (Week: week, Position: index + 1))
                .ToDictionary(item => item.Week, item => item.Position);
            foreach (var day in phase) mapped[day.LineId] = order[day.PhaseWeek];
        }
        if (!workouts.Any(day => mapped.TryGetValue(day.LineId, out var week) && week != day.PhaseWeek)) return (workouts, false);
        return (workouts.Select(day => mapped.TryGetValue(day.LineId, out var week) && week != day.PhaseWeek
            ? day with { PhaseWeek = week }
            : day).ToList(), true);
    }

    public static List<List<DraftWorkout>> GroupDraftPhases(IEnumerable<DraftWorkout> workouts)
    {
        var ordered = workouts.Select((workout, index) => (workout, index))
            .OrderBy(item => item.workout.Week).ThenBy(item => item.index).Select(item => item.workout).ToList();
        var groups = new List<List<DraftWorkout>>();
        foreach (var workout in ordered)
        {
            var previous = groups.Count == 0 ? null : groups[^1][^1];
            var same = previous is not null &&
                string.Equals(previous.Block?.Trim() ?? "", workout.Block?.Trim() ?? "", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(previous.Phase?.Trim() ?? "", workout.Phase?.Trim() ?? "", StringComparison.OrdinalIgnoreCase);
            var reset = previous is not null && previous.PhaseWeek > 1 && workout.Week > previous.Week && workout.PhaseWeek <= previous.PhaseWeek;
            if (groups.Count == 0 || !same || reset) groups.Add([]);
            groups[^1].Add(workout);
        }
        return groups;
    }

    public static SetPrescription ToPrescription(DraftSet set)
        => new(set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.LoadText, set.Notes,
            set.RepsText, set.RestText, set.Percent1Rm, set.Rir, set.Warmup, set.RepsSource, set.RpeSource, set.RestSource,
            SourcePage: set.SourcePage);

    public static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source)
    {
        // The outline model owns the semantic boundaries. Never derive week ranges from a count
        // of training days: a three-day schedule and a seven-day schedule have different weeks.
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        var result = source.Select((chunk, index) => new ImportChunk(
            ImportNormalization.Label(chunk.Label, 200, $"Section {index + 1}"),
            ImportNormalization.Text(chunk.Block, 80), ImportNormalization.Text(chunk.Phase, 120),
            chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount)).ToList();
        Validation.Require(result.Select(c => c.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() == result.Count,
            "AI returned duplicate extraction chunk labels.", 422);
        ValidateChunkRanges(result);
        Validation.Require(result.Sum(c => c.DayCount) <= 400, "This program is larger than the importer supports.", 422);
        return result;
    }

    public static List<ImportChunk> SplitChunks(List<ImportChunk> source)
    {
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        Validation.Require(source.Select(c => c.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() == source.Count,
            "AI returned duplicate extraction chunk labels.", 422);
        Validation.Require(source.All(c => c.DayCount is > 0 and <= 80 && c.WeekFrom > 0 && c.WeekTo >= c.WeekFrom && c.PageFrom > 0 && c.PageTo >= c.PageFrom),
            "AI returned an invalid extraction chunk.", 422);
        ValidateChunkRanges(source);
        Validation.Require(source.Sum(c => c.DayCount) <= 400, "This program is larger than the importer supports.", 422);
        return source;
    }

    public static void ValidateChunkRanges(IEnumerable<ImportChunk> chunks)
    {
        foreach (var group in chunks.GroupBy(c => (Block: c.Block?.Trim() ?? "", Phase: c.Phase?.Trim() ?? "")))
        {
            var ordered = group.OrderBy(c => c.WeekFrom).ThenBy(c => c.PageFrom).ThenBy(c => c.WeekTo).ToList();
            for (var index = 1; index < ordered.Count; index++)
            {
                var previous = ordered[index - 1]; var current = ordered[index];
                if (current.WeekFrom <= previous.WeekTo)
                {
                    // A phase may be split into page sections for the same week. That is safe
                    // only when the source ranges are disjoint; extracted duplicate slots are
                    // rejected again when the chunks are merged.
                    Validation.Require(current.PageFrom > previous.PageTo || current.PageTo < previous.PageFrom,
                        $"Extraction chunks for phase '{group.Key.Phase}' overlap in their source pages. Review the outline before continuing.", 422);
                }
                else
                {
                    Validation.Require(current.WeekFrom == previous.WeekTo + 1,
                        $"Extraction chunks for phase '{group.Key.Phase}' skip a week. Review the outline before continuing.", 422);
                }
            }
        }
    }

    public static List<ImportChunk> ReadChunks(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportChunk>>(json);

    /// What one chunk contributes to the draft, once its days have been reconciled with what the
    /// earlier sections already read.
    public sealed record ChunkMerge(List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices);

    /// Merges one chunk's days into the draft's world view. Both of the things that used to fail a
    /// section here are judgements about a document, not defects in it: the outline's `dayCount` is
    /// an estimate made from page previews, and two days can genuinely look identical — a program
    /// that runs the same session twice in a week, with no weekday printed next to either, says so
    /// in exactly the way a mistaken repeat would. Failing the chunk over either left the import
    /// stuck on a section that failed the same way on every retry, so both are reconciled and
    /// reported instead. A day outside the chunk's weeks is still a real error and stays retryable.
    public static ChunkMerge ReconcileChunkCoverage(ImportDraft existing, ImportDraft extracted, ImportChunk chunk)
    {
        Validation.Require(extracted.Workouts.All(day => day.Week >= chunk.WeekFrom && day.Week <= chunk.WeekTo),
            $"AI returned a day outside the week range for '{chunk.Label}'. Retry this chunk.", 422);

        var notices = new List<ImportReviewIssue>();
        var existingKeys = existing.Workouts.Select(DayKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var takenSlots = existing.Workouts.Where(day => day.Weekday is not null)
            .Select(day => (day.Week, Weekday: day.Weekday!.Value)).ToHashSet();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var workouts = new List<DraftWorkout>();
        var repeated = 0;

        foreach (var day in extracted.Workouts)
        {
            var key = DayKey(day);
            if (existingKeys.Contains(key))
            {
                // An earlier section already read this exact day. Merging it again would put the
                // same session into the program twice, so this copy is dropped rather than doubled.
                notices.Add(new ImportReviewIssue("duplicate_day_dropped",
                    $"'{chunk.Label}' repeated {day.Name} from an earlier section; it was kept once.",
                    "warning", day.SourcePage ?? chunk.PageFrom));
                continue;
            }
            if (!seen.Add(key)) repeated++;

            // Two sessions cannot hold the same weekday in one week. The repeat keeps its place in
            // the program and loses only the day it claimed, which the review screen then asks for.
            var placed = day;
            if (day.Weekday is { } weekday && !takenSlots.Add((day.Week, weekday)))
            {
                placed = day with { Weekday = null };
                notices.Add(new ImportReviewIssue("weekday_taken",
                    $"Week {day.Week} already has a session on that weekday, so {day.Name} needs one of its own.",
                    "warning", day.SourcePage ?? chunk.PageFrom));
            }
            workouts.Add(placed);
        }

        if (repeated > 0)
            notices.Add(new ImportReviewIssue("repeated_day",
                $"'{chunk.Label}' lists {repeated} day{(repeated == 1 ? "" : "s")} that read identically. Both were kept — delete one in the review if the document only has it once.",
                "warning", chunk.PageFrom));

        if (workouts.Count != chunk.DayCount)
            notices.Add(new ImportReviewIssue("chunk_day_count",
                $"'{chunk.Label}' was outlined as about {chunk.DayCount} day{(chunk.DayCount == 1 ? "" : "s")} but reads as {workouts.Count}. Check that section in the review.",
                "warning", chunk.PageFrom));

        return new ChunkMerge(workouts, notices);
    }

    public static List<ImportReviewIssue> ReadNotices(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportReviewIssue>>(json);

    public static string DayKey(DraftWorkout day)
        => $"{day.Week}|{day.PhaseWeek}|{day.Block?.Trim()}|{day.Phase?.Trim()}|{day.Weekday}|{day.Name.Trim()}";

    public static void ValidateChunkPages(IEnumerable<ImportChunk> chunks, string coverageJson)
    {
        if (string.IsNullOrWhiteSpace(coverageJson)) return;
        var coverage = Json.Read<List<PdfPageCoverage>>(coverageJson);
        if (coverage.Count == 0) return;
        var pageCount = coverage.Max(page => page.Page);
        foreach (var chunk in chunks)
            Validation.Require(chunk.PageFrom <= pageCount && chunk.PageTo <= pageCount,
                $"Extraction chunk '{chunk.Label}' refers to pages outside this PDF. Review the outline and retry.", 422);
    }

    public static void ValidateDraftPages(ImportDraft draft, string coverageJson)
    {
        if (string.IsNullOrWhiteSpace(coverageJson)) return;
        var coverage = Json.Read<List<PdfPageCoverage>>(coverageJson);
        if (coverage.Count == 0) return;
        var pageCount = coverage.Max(page => page.Page);
        foreach (var page in draft.Workouts.SelectMany(workout =>
                     new[] { workout.SourcePage }.Concat(workout.Exercises.Select(exercise => exercise.SourcePage))
                         .Concat(workout.Exercises.SelectMany(exercise => exercise.Sets).Select(set => set.SourcePage))))
            Validation.Require(page is null || page.Value <= pageCount,
                "The extracted program refers to a source page outside this PDF. Review the draft and retry.", 422);
    }
}
