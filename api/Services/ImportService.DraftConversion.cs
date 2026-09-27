using System.Globalization;
using System.Diagnostics;
using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// Every id the model proposes is checked against the live catalog here. An id that does not
    /// resolve is dropped to null so the reviewer can keep the written exercise name.
    public async Task<ImportDraft> ToDraft(AiProgram program, CancellationToken ct)
    {
        var catalogSnapshot = await ImportCatalog(ct);
        var active = catalogSnapshot.Active;
        var library = catalogSnapshot.Matches;
        var canonicalNames = catalogSnapshot.Names;
        var title = ImportNormalization.Label(program.ProgramTitle ?? program.ProgramName, 120, "Imported program");
        var workouts = new List<DraftWorkout>();
        if (program.Days is { } days)
        {
            foreach (var day in days)
                workouts.Add(ToDraftWorkout(day.Block, day.Phase, day.WeekNumber, day.PhaseWeek, day.DayName, day.IsRestDay, day.Notes, day.Exercises, active, library, canonicalNames, sourcePage: day.SourcePage));
        }
        else
        {
            foreach (var week in program.Weeks!.OrderBy(w => w.Week))
                foreach (var workout in week.Workouts ?? [])
                    workouts.Add(ToDraftWorkout(null, null, week.Week, 1, workout.Name, false, workout.Notes, workout.Exercises, active, library, canonicalNames, workout.Focus));
        }
        return new ImportDraft(title, workouts);
    }

    /// Catalog rows do not change during a single import pass. Reusing these account-scoped
    /// lookups avoids repeating three catalog queries for every verification read.
    private async Task<ImportCatalogSnapshot> ImportCatalog(CancellationToken ct)
    {
        if (importCatalogSnapshot is { } cached) return cached;
        await importCatalogGate.WaitAsync(ct);
        try
        {
            if (importCatalogSnapshot is { } loaded) return loaded;
            var timer = Stopwatch.StartNew();
            var active = await catalog.ActiveIds(ct);
            var matches = await catalog.MatchIndex(ct);
            var names = (await catalog.All(ct)).ToDictionary(exercise => exercise.Id, exercise => exercise.Name);
            importCatalogSnapshot = new ImportCatalogSnapshot(active, matches, names);
            logger?.LogInformation("Import catalog snapshot loaded in {ElapsedMilliseconds} ms ({ActiveCount} active IDs, {MatchCount} match entries).",
                timer.ElapsedMilliseconds, active.Count, matches.Count);
            return importCatalogSnapshot;
        }
        finally { importCatalogGate.Release(); }
    }

    private static DraftWorkout ToDraftWorkout(string? block, string? phase, int week, int phaseWeek, string? name, bool restDay,
        string? notes, List<AiExercise>? sourceExercises, HashSet<Guid> active, Dictionary<string, Guid> library,
        Dictionary<Guid, string> canonicalNames, string? focus = null, int? sourcePage = null)
    {
        var exercises = new List<DraftExercise>();
        if (!restDay)
        {
            foreach (var source in sourceExercises ?? [])
            {
                var rawName = source.SourceName?.Trim() ?? "";
                var sequenceGroup = ImportNormalization.Text(source.SequenceGroup, 8) ?? "";

                // A table cell often embeds a superset tag like "A1: Seated Calf Raise". Strip the
                // tag from the movement name and adopt it as sequenceGroup if none was stated.
                var cleanName = rawName;
                if (ImportSetTags.Find(rawName) is { } tag && ImportSetTags.Strip(rawName) is { Length: > 0 } untagged)
                {
                    if (string.IsNullOrEmpty(sequenceGroup))
                        sequenceGroup = ImportNormalization.Text(tag, 8) ?? "";
                    cleanName = untagged;
                }

                // Exercise cells can carry embedded video hyperlinks from PDF design layers.
                // Pull URLs into the notes so the written movement name matches the catalog cleanly.
                var urlMatches = Regex.Matches(cleanName, @"https?://\S+|www\.\S+");
                var extractedUrls = new List<string>();
                if (urlMatches.Count > 0)
                {
                    foreach (Match m in urlMatches) extractedUrls.Add(m.Value);
                    cleanName = Regex.Replace(cleanName, @"https?://\S+|www\.\S+", "").Trim();
                    cleanName = Regex.Replace(cleanName, @"\(\s*\)|\[\s*\]", "").Trim();
                }

                Guid? id = Guid.TryParse(source.ExerciseId, out var parsed) && active.Contains(parsed) ? parsed : null;
                id ??= CatalogMatching.Find(library, cleanName);
                if (id == null && cleanName != rawName) id ??= CatalogMatching.Find(library, rawName);
                var working = source.Sets.Select(set => ToDraftSet(set, source.SourcePage)).Select(ImportSetKinds.Tagged).ToList();
                // A training table states its working sets as a count in its own column — "WORKING
                // SETS: 2" — rather than as one row per set, and a read that returns a single row
                // for it loses every set but one. The stated count is authoritative over the rows:
                // the last row is repeated up to it, marked as this app's own expansion.
                var stated = ParseSetCount(source.WorkingSets);
                while (working.Count > 0 && working.Count < stated)
                    working.Add(ImportSetKinds.Repeated(working[^1]));
                working = ImportSetKinds.Compose(ImportSetKinds.PerSetReps(working), ParseWarmupCount(source.WarmupSets), rawName);
                var noteParts = new[] { ImportNormalization.Text(source.Notes, 1000), ImportNormalization.Text(source.CoachingNotes, 1000) }
                    .Concat(extractedUrls)
                    .Where(value => value is not null).Select(value => value!).ToList();
                var alternates = PrintedAlternates(source.Substitutions, id, library, canonicalNames);
                var substitutions = alternates.Take(2).ToList();
                if (alternates.Count > 2) noteParts.Add($"Other alternates: {string.Join(", ", alternates.Skip(2))}");
                exercises.Add(new DraftExercise(Guid.NewGuid(), ImportNormalization.Label(cleanName.Length > 0 ? cleanName : rawName, 160, "Unnamed exercise"), id, Note(noteParts), working,
                    sequenceGroup, substitutions, ImportNormalization.Page(source.SourcePage), RestSeconds: DeriveRestSeconds(working)));
            }
        }
        // Weeks, weekdays and page numbers are brought into the range a stored day has rather than
        // failing the section that reported them: a miscounted page or a weekday outside Monday to
        // Sunday is a slip in one field, not a reason to throw away a whole transcription.
        var storedWeek = ImportNormalization.Week(week);
        return new DraftWorkout(Guid.NewGuid(), storedWeek, ImportNormalization.Text(name, 120) ?? "",
            ImportNormalization.Text(focus, 120), ImportNormalization.Text(notes, 2000), exercises,
            ImportNormalization.Text(block, 80), ImportNormalization.Text(phase, 120), ImportNormalization.Week(phaseWeek), restDay,
            ImportNormalization.Page(sourcePage));
    }

    /// The printed alternatives in order. One takes the library's spelling only when the library
    /// spells the whole of it, so a quick swap finds it; otherwise the printed words stand. An
    /// alternative is never renamed into the exercise it replaces, and two printed options that
    /// reach the same entry stay two options.
    private static List<string> PrintedAlternates(List<string>? printed, Guid? primaryId,
        Dictionary<string, Guid> library, Dictionary<Guid, string> canonicalNames)
    {
        var alternates = new List<string>();
        var claimed = new HashSet<Guid>();
        if (primaryId is { } primary) claimed.Add(primary);
        foreach (var option in printed ?? [])
        {
            if (CatalogService.IsPlaceholder(option) || ImportNormalization.Text(option, 160) is not { } clean) continue;
            var name = CatalogMatching.FindWhole(library, clean) is { } match && claimed.Add(match)
                && canonicalNames.TryGetValue(match, out var canonical)
                && CatalogMatching.WordSetKey(CatalogService.Normalize(clean)) == CatalogMatching.WordSetKey(CatalogService.Normalize(canonical))
                ? canonical : clean;
            if (!alternates.Contains(name, StringComparer.OrdinalIgnoreCase)) alternates.Add(name);
        }
        return alternates;
    }

    /// Joins what an exercise's note is made of, within the length a note can hold. Trimming the
    /// tail is better than failing the import over an unusually chatty source row.
    private static string? Note(List<string> parts)
    {
        if (parts.Count == 0) return null;
        var note = string.Join(" — ", parts);
        return note.Length <= 1000 ? note : note[..1000].TrimEnd();
    }

    private static int? DeriveRestSeconds(List<DraftSet> sets)
    {
        var candidates = sets.Where(s => !s.Warmup && s.RestSeconds is >= 0 and <= 3600)
            .Select(s => s.RestSeconds!.Value)
            .ToList();
        if (candidates.Count == 0)
        {
            candidates = sets.Where(s => s.RestSeconds is >= 0 and <= 3600)
                .Select(s => s.RestSeconds!.Value)
                .ToList();
        }
        if (candidates.Count == 0) return null;
        return candidates
            .GroupBy(v => v)
            .OrderByDescending(g => g.Count())
            .First()
            .Key;
    }

    private static DraftSet ToDraftSet(AiSet set, int? exerciseSourcePage)
    {
        // A stored set has an RPE on the 6-10 scale and a rest inside an hour. A row written as a
        // timed hold or a high-to-low range gives those unclearly, so each value is brought into
        // range and marked inferred when it had to move. Reps a row never states stay empty
        // rather than becoming a one-rep target. What the page said stays in the text fields.
        var repsText = ImportNormalization.RepsText(set.RepsText);
        var reps = ImportNormalization.Reps(set.RepMin, set.RepMax, repsText);
        var rpeValue = ImportNormalization.Rpe(set.TargetRpe);
        var restValue = ImportNormalization.Rest(DeriveRest(set.RestText, set.RestSeconds));
        var repsSource = ImportNormalization.Provenance(set.RepsSource);
        if (reps.Adjusted) repsSource = "inferred";
        if (reps.Min is not null && !string.IsNullOrWhiteSpace(repsText)
            && !Regex.IsMatch(repsText.Trim(), @"^\d+\s*(?:(?:[-–]|to)\s*\d+)?\s*(?:reps?)?$", RegexOptions.IgnoreCase)) repsSource = "inferred";
        var rpe = rpeValue.Value;
        var rpeSource = rpeValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RpeSource);
        if (rpe == null && TryFirstNumber(set.Rir, out var rir))
        {
            // RIR is useful evidence, but an out-of-range conversion is not a reason to invent a
            // target that the document never supplied. Leave it visibly unresolved for review.
            var intRir = (int)Math.Round((double)rir);
            var inferred = 10 - intRir;
            if (inferred is >= 6 and <= 10) { rpe = inferred; rpeSource = "inferred"; }
        }
        var rirText = ImportNormalization.Text(set.Rir, 16);
        if (string.IsNullOrWhiteSpace(rirText) && rpe != null)
        {
            var calculatedRir = (int)Math.Round(10 - rpe.Value);
            if (calculatedRir is >= 0 and <= 4) rirText = calculatedRir.ToString(CultureInfo.InvariantCulture);
        }
        else if (TryFirstNumber(rirText, out var parsedRir))
        {
            rirText = ((int)Math.Round((double)parsedRir)).ToString(CultureInfo.InvariantCulture);
        }
        return new DraftSet(reps.Min, reps.Max, rpe, restValue.Value,
            ImportNormalization.Text(set.Tempo, 24), ImportNormalization.Text(set.LoadText, 60), ImportNormalization.Text(set.Notes, 400),
            repsSource, rpeSource, restValue.Adjusted ? "inferred" : ImportNormalization.Provenance(set.RestSource),
            repsText, ImportNormalization.Text(set.RestText, 24),
            rirText, false, ImportNormalization.Page(set.SourcePage ?? exerciseSourcePage));
    }

    private static int? DeriveRest(string? text, int? fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        var range = Regex.Match(text, @"(?<min>\d+(?:\.\d+)?)\s*(?:[-–]|to)\s*(?<max>\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
        var lower = text.ToLowerInvariant();
        if (range.Success && double.TryParse(range.Groups["min"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var minimum) &&
            double.TryParse(range.Groups["max"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var maximum))
        {
            var average = (minimum + maximum) / 2;
            var isSec = Regex.IsMatch(lower, @"\b(?:sec|secs|second|seconds)\b|(?:\d|\))\s*s\b");
            var isHr = lower.Contains("hour") || lower.Contains("hr");
            var multiplier = isSec ? 1 : isHr ? 3600 : (Regex.IsMatch(lower, @"\b(?:m|min|mins|minute|minutes)\b|(?:\d|\))\s*m\b") || average <= 10) ? 60 : 1;
            return (int)Math.Round(average * multiplier, MidpointRounding.AwayFromZero);
        }
        if (!TryFirstNumber(text, out var number)) return fallback;
        // When the text carries no unit letters the AI's restSeconds is a better authority than
        // defaulting to seconds, because the model reads document-level context like "REST TIMES
        // ARE GIVEN IN MINUTES" that this parser cannot see.
        if (!Regex.IsMatch(text, @"[a-zA-Z]"))
        {
            if (fallback is not null) return fallback;
            // When no fallback exists, small decimal or integer numbers (<= 10) in training tables
            // represent minutes (e.g. 1.0, 1.5, 2.0, 3.0); resistance rest is never 2 seconds.
            if (number > 0 && number <= 10)
                return (int)Math.Round(number * 60, MidpointRounding.AwayFromZero);
            return (int)Math.Round(number, MidpointRounding.AwayFromZero);
        }
        var isSingleSec = Regex.IsMatch(lower, @"\b(?:sec|secs|second|seconds)\b|(?:\d|\))\s*s\b");
        var isSingleHr = lower.Contains("hour") || lower.Contains("hr");
        var singleMultiplier = isSingleSec ? 1 : isSingleHr ? 3600 : (Regex.IsMatch(lower, @"\b(?:m|min|mins|minute|minutes)\b|(?:\d|\))\s*m\b") || number <= 10) ? 60 : 1;
        return (int)Math.Round(number * singleMultiplier, MidpointRounding.AwayFromZero);
    }

    private static int ParseWarmupCount(string? text)
    {
        if (!TryFirstNumber(text, out var number)) return 0;
        return Math.Clamp((int)Math.Floor(number), 0, 8);
    }

    /// A stated working-set count, held to what one exercise can carry.
    private static int ParseSetCount(string? text)
    {
        if (!TryFirstNumber(text, out var number)) return 0;
        return Math.Clamp((int)Math.Floor(number), 0, ImportDayShape.MaxExerciseSets);
    }

    private static bool TryFirstNumber(string? text, out double value)
    {
        var match = Regex.Match(text ?? "", @"\d+(?:\.\d+)?");
        if (!match.Success || !double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out value)) { value = 0; return false; }
        return true;
    }


}
