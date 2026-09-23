using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static partial class ImportValidation
{
    public static string CanonicalBlock(string? block)
    {
        var value = Collapse(block);
        if (value.Length == 0) return "";
        var numbered = Regex.Match(value, @"^block\s+(?<number>\d+)$", RegexOptions.IgnoreCase);
        return numbered.Success ? $"Block {numbered.Groups["number"].Value}" : value;
    }

    private static string Identity(string? value) => Collapse(value).ToUpperInvariant();

    private static string Collapse(string? value)
        => Regex.Replace(value?.Trim() ?? "", @"\s+", " ");

    /// What the reviewer must resolve before the draft can become a program. Each kind is counted
    /// once and names the first few days it applies to, so the review reads as a summary rather
    /// than a log while the target points back to a concrete editor field.
    public static List<ImportReviewIssue> ReviewIssues(ImportDraft draft)
    {
        var issues = new List<ImportReviewIssue>();
        var training = draft.Workouts.Where(w => !w.IsRestDay).ToList();

        var overflowRows = draft.Workouts
            .GroupBy(day => day.Week)
            .SelectMany(group => group.Skip(7))
            .ToList();
        if (overflowRows.Count > 0)
        {
            var first = overflowRows[0];
            issues.Add(new ImportReviewIssue("week_day_overflow",
                $"{Count(overflowRows.Count, "day exceeds", "days exceed")} the 7-day limit for a week. Delete {(overflowRows.Count == 1 ? "it" : "them")} or change {(overflowRows.Count == 1 ? "its" : "their")} week in the review. {Naming(overflowRows)}",
                "warning", first.SourcePage, WorkoutLineId: first.LineId, TargetField: "week"));
        }

        var working = training.SelectMany(day => day.Exercises.SelectMany(exercise =>
            exercise.Sets.Select((set, index) => (day, exercise, set, index)))).Where(item => !item.set.Warmup).ToList();
        var loadSpecified = working.Where(item => item.set.TargetRpe is null && IsPercentageLoad(item.set.LoadText)).ToList();
        if (loadSpecified.Count > 0)
            issues.Add(new ImportReviewIssue("percentage_load_without_rpe",
                $"{Count(loadSpecified.Count, "working set has", "working sets have")} a percentage load prescription and no RIR target; the load is preserved as source text. {Naming(loadSpecified.Select(item => item.day))}",
                "info", loadSpecified[0].set.SourcePage ?? loadSpecified[0].day.SourcePage,
                WorkoutLineId: loadSpecified[0].day.LineId, ExerciseLineId: loadSpecified[0].exercise.LineId,
                SetIndex: loadSpecified[0].index, TargetField: "targetRpe"));

        var unrated = working.Where(item => item.set.TargetRpe is null && !IsPercentageLoad(item.set.LoadText)).ToList();
        if (unrated.Count > 0)
            issues.Add(new ImportReviewIssue("rpe_unspecified",
                $"{Count(unrated.Count, "working set has", "working sets have")} no target RIR in the PDF; {(unrated.Count == 1 ? "it remains" : "they remain")} unspecified. {Naming(unrated.Select(item => item.day))}",
                "warning", unrated[0].set.SourcePage ?? unrated[0].day.SourcePage,
                WorkoutLineId: unrated[0].day.LineId, ExerciseLineId: unrated[0].exercise.LineId,
                SetIndex: unrated[0].index, TargetField: "targetRpe"));

        // The first movement of a superset rests only after its partner, so a table prints "-" for
        // it and a session skips that rest anyway; it is not a rest the document left out.
        var unrested = working.Where(item => item.set.RestSeconds is null && string.IsNullOrWhiteSpace(item.set.RestText)
            && !LeadsIntoPartner(item.day, item.exercise)).ToList();
        if (unrested.Count > 0)
            issues.Add(new ImportReviewIssue("rest_unspecified",
                $"{Count(unrested.Count, "set has", "sets have")} no stated rest in the PDF; {(unrested.Count == 1 ? "it remains" : "they remain")} unspecified. {Naming(unrested.Select(item => item.day))}",
                "warning", unrested[0].set.SourcePage ?? unrested[0].day.SourcePage,
                WorkoutLineId: unrested[0].day.LineId, ExerciseLineId: unrested[0].exercise.LineId,
                SetIndex: unrested[0].index, TargetField: "rest"));

        var weeks = draft.Workouts.Select(day => day.Week).Distinct().Order().ToList();
        var missingWeeksBetweenPhases = new List<int>();
        var phases = GroupDraftPhases(draft.Workouts);
        for (var index = 1; index < weeks.Count; index++)
        {
            if (weeks[index] == weeks[index - 1] + 1) continue;
            var missingWeeks = Enumerable.Range(weeks[index - 1] + 1, weeks[index] - weeks[index - 1] - 1).ToList();
            foreach (var missingWeek in missingWeeks)
            {
                var coveredByPhaseGap = phases.Any(phase =>
                {
                    var phaseWeeks = phase.Select(day => day.Week).Distinct().Order().ToList();
                    return phaseWeeks.Count > 1 && phaseWeeks[0] < missingWeek && phaseWeeks[^1] > missingWeek;
                });
                if (!coveredByPhaseGap) missingWeeksBetweenPhases.Add(missingWeek);
            }
        }
        if (missingWeeksBetweenPhases.Count > 0)
        {
            var firstMissingWeek = missingWeeksBetweenPhases[0];
            var nextDay = draft.Workouts.Where(day => day.Week > firstMissingWeek).MinBy(day => day.Week)!;
            var uniqueMissingWeeks = missingWeeksBetweenPhases.Distinct().Order().ToList();
            var missing = string.Join(", ", uniqueMissingWeeks);
            var gapMessage = uniqueMissingWeeks.Count == 1
                ? $"Program week {missing} has no days. Add the missing week or move later days in the review."
                : $"Program weeks {missing} have no days. Add the missing weeks or move later days in the review.";
            issues.Add(new ImportReviewIssue("program_week_gap",
                gapMessage,
                "warning", nextDay.SourcePage, WorkoutLineId: nextDay.LineId, TargetField: "week"));
        }

        foreach (var phase in phases)
        {
            var phaseWeeks = phase.Select(day => day.Week).Distinct().OrderBy(week => week).ToList();
            for (var index = 1; index < phaseWeeks.Count; index++)
                if (phaseWeeks[index] != phaseWeeks[index - 1] + 1)
                    issues.Add(new ImportReviewIssue("phase_week_gap",
                        $"'{phase[0].Phase}' jumps from week {phaseWeeks[index - 1]} to week {phaseWeeks[index]}; check that nothing is missing.",
                        "warning", phase[0].SourcePage, WorkoutLineId: phase[0].LineId, TargetField: "week"));
        }
        return issues;
    }

    private static bool LeadsIntoPartner(DraftWorkout day, DraftExercise exercise)
    {
        var index = day.Exercises.IndexOf(exercise);
        return !string.IsNullOrWhiteSpace(exercise.SequenceGroup) && index >= 0 && index + 1 < day.Exercises.Count
            && string.Equals(day.Exercises[index + 1].SequenceGroup, exercise.SequenceGroup, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPercentageLoad(string? value)
        => !string.IsNullOrWhiteSpace(value) && Regex.IsMatch(value.Trim(),
            @"^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*(?:1\s*RM)?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static string Count(int count, string one, string many)
        => count == 1 ? $"1 {one}" : $"{count} {many}";

    /// Which days a counted issue falls on, without listing a hundred of them.
    private static string Naming(IEnumerable<DraftWorkout> days)
    {
        var names = days.Select(day => day.Name.Trim()).Where(name => name.Length > 0).Distinct().ToList();
        if (names.Count == 0) return "";
        var shown = names.Take(3).ToList();
        return names.Count <= shown.Count
            ? $"On {string.Join(", ", shown)}."
            : $"On {string.Join(", ", shown)} and {names.Count - shown.Count} more.";
    }

    public static async Task ValidateDraft(ImportDraft draft, CatalogService catalog, CancellationToken ct)
    {
        Validation.Name(draft.ProgramName, "Program name");
        Validation.Require(draft.Workouts is { Count: > 0 and <= 400 }, "A program needs between 1 and 400 days.");
        Validation.Require(draft.Workouts.All(w => w.Week is > 0 and <= 104), "Program weeks must be between 1 and 104.");
        Validation.Require(draft.Workouts.Select(w => w.LineId).Distinct().Count() == draft.Workouts.Count, "A program contains duplicate workout rows.");
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
        Validation.Require(workout.IsRestDay ? workout.Exercises is { Count: 0 } : workout.Exercises is { Count: > 0 and <= 40 },
            workout.IsRestDay ? "A rest day cannot contain exercises." : "Each workout needs between 1 and 40 exercises.");
        foreach (var exercise in workout.Exercises)
        {
            Validation.Name(exercise.SourceName, "Exercise name", 160); Validation.Text(exercise.Notes, 1000, "Exercise notes");
            Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "Exercise source page is invalid.");
            Validation.Text(exercise.SequenceGroup, 8, "Sequence group"); Validation.Substitutions(exercise.Substitutions);
            Validation.ExerciseRestSeconds(exercise.RestSeconds);
            Validation.Prescriptions(exercise.Sets.Select(ToPrescription).ToList(), false);
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
            set.RepsText, set.RestText, set.Rir, set.Warmup, set.RepsSource, set.RpeSource, set.RestSource,
            SourcePage: set.SourcePage);

    public static List<ImportChunk> SplitChunks(List<AiOutlineChunk> source)
    {
        // The outline model owns the semantic boundaries. Never derive week ranges from a count
        // of training days: a three-day schedule and a seven-day schedule have different weeks.
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        return Sections(source.Select((chunk, index) => new ImportChunk(
            ImportNormalization.Label(chunk.Label, 200, $"Section {index + 1}"),
            ImportNormalization.Text(chunk.Block, 80), ImportNormalization.Text(chunk.Phase, 120),
            chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount)).ToList());
    }

    public static List<ImportChunk> SplitChunks(List<ImportChunk> source)
    {
        Validation.Require(source.Count is > 0 and <= 24, "This program has too many extraction chunks.", 422);
        Validation.Require(source.All(c => c.DayCount is > 0 and <= 80 && c.WeekFrom > 0 && c.WeekTo >= c.WeekFrom && c.PageFrom > 0 && c.PageTo >= c.PageFrom),
            "AI returned an invalid extraction chunk.", 422);
        return Sections(source);
    }

    /// The sections an import will actually read, from the boundaries the outline drew: divided so
    /// no read is asked for more than one answer holds, then named apart and checked as a whole.
    private static List<ImportChunk> Sections(List<ImportChunk> source)
    {
        var result = DistinctLabels(ImportSections.Divide(source));
        Validation.Require(result.Count <= ImportSections.MaxSections, "This program has too many extraction chunks.", 422);
        ValidateChunkRanges(result);
        Validation.Require(result.Sum(c => c.DayCount) <= 400, "This program is larger than the importer supports.", 422);
        return result;
    }

    /// A section label is what the reviewer reads while the import runs; nothing is keyed on it,
    /// and sections are addressed by their outline position. A document regularly earns two
    /// sections the same name — "Deload" printed at the end of every block, or one phase split
    /// across page ranges — which is its naming convention rather than a defect in the read.
    /// Refusing the whole outline over it left the import dead on arrival on a document that
    /// failed the same way on every retry, so a repeat is renamed with whatever actually
    /// separates it from the first.
    public static List<ImportChunk> DistinctLabels(List<ImportChunk> chunks)
    {
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var first = new Dictionary<string, ImportChunk>(StringComparer.OrdinalIgnoreCase);
        return chunks.Select(chunk =>
        {
            if (taken.Add(chunk.Label))
            {
                first[chunk.Label] = chunk;
                return chunk;
            }
            // A name can also be taken by an earlier rename rather than by a section of its own,
            // in which case there is nothing to compare against and every detail is worth trying.
            var original = first.TryGetValue(chunk.Label, out var owner) ? owner : chunk with { WeekFrom = 0, PageFrom = 0 };
            foreach (var candidate in LabelCandidates(chunk, original))
                if (taken.Add(candidate)) return chunk with { Label = candidate };
            return chunk;
        }).ToList();
    }

    /// Ordered by how much a detail actually separates this section from the one that already
    /// owns the name: a detail the two share says nothing and is skipped, and a plain count is
    /// the last resort when they differ in nothing a reviewer can see.
    private static IEnumerable<string> LabelCandidates(ImportChunk chunk, ImportChunk original)
    {
        var weeks = $"weeks {chunk.WeekFrom}-{chunk.WeekTo}";
        var pages = $"pages {chunk.PageFrom}-{chunk.PageTo}";
        var sameWeeks = chunk.WeekFrom == original.WeekFrom && chunk.WeekTo == original.WeekTo;
        var samePages = chunk.PageFrom == original.PageFrom && chunk.PageTo == original.PageTo;
        if (!sameWeeks) yield return Suffixed(chunk.Label, weeks);
        if (!samePages) yield return Suffixed(chunk.Label, pages);
        if (!sameWeeks && !samePages) yield return Suffixed(chunk.Label, $"{weeks}, {pages}");
        for (var index = 2; index <= 32; index++) yield return Suffixed(chunk.Label, index.ToString());
    }

    /// Keeps a qualified label inside the 200 characters the column holds, trimming the name
    /// rather than the detail that makes it distinct.
    public static string SuffixedLabel(string label, string detail) => Suffixed(label, detail);

    private static string Suffixed(string label, string detail)
    {
        var suffix = $" ({detail})";
        var room = Math.Max(0, 200 - suffix.Length);
        return (label.Length <= room ? label : label[..room].TrimEnd()) + suffix;
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

    public static List<ImportReviewIssue> ReadNotices(string json)
        => string.IsNullOrWhiteSpace(json) ? [] : Json.Read<List<ImportReviewIssue>>(json);

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
