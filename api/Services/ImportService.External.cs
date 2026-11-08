using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    public async Task<ImportView> CreateExternalImport(string input, string fileName, CancellationToken ct)
    {
        Validation.Require(db.CurrentUser is not null, "Sign in to import a program.", 401);
        using var envelope = ExternalImportEnvelope.Parse(input);
        ExternalImportSchema.Validate(envelope.RootElement);
        ExternalProgram source;
        try { source = envelope.RootElement.GetProperty("program").Deserialize<ExternalProgram>(Json.Options)!; }
        catch (JsonException error)
        {
            var (path, message) = ExternalImportFieldHints.Describe("$.program" + (error.Path is null or "$" ? "" : error.Path[1..]));
            throw ExternalImportPath.WithPath(new DomainException(message, 400), path);
        }
        ExternalImportPath.At("$.program.days", () => Validation.Require(source is not null && source.Days is not null, "Add a list of program days."));
        ExternalImportPath.At("$.program.name", () => Validation.Name(source!.Name, "Program name"));
        ExternalImportPath.At("$.program.sourceWeekDays", () => Validation.Require(source!.SourceWeekDays is null or >= 1 and <= ExternalImportLimits.MaxCycleDays, "Source cycle length must be between 1 and 14 days."));
        ExternalImportPath.At("$.program.days", () => Validation.Require(source!.Days!.Count is > 0 and <= ExternalImportLimits.MaxDays, "A program needs between 1 and 400 days."));
        var snapshot = await ImportCatalog(ct);
        var days = new List<DraftWorkout>();
        var exerciseErrors = new List<ExternalImportPath.FieldError>();
        var dayKeys = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var (day, dayIndex) in source!.Days.Select((item, index) => (item, index)))
        {
            var dayPath = $"$.program.days[{dayIndex}]";
            ExternalImportPath.At(dayPath, () => Validation.Require(day is not null, "Add the missing workout day."));
            ExternalImportPath.At(dayPath + ".key", () => Validation.Name(day!.Key, "Day key", 120));
            ExternalImportPath.At(dayPath + ".name", () => Validation.Name(day!.Name, "Workout name"));
            ExternalImportPath.At(dayPath + ".focus", () => Validation.Text(day!.Focus, 120, "Focus"));
            ExternalImportPath.At(dayPath + ".notes", () => Validation.Text(day!.Notes, 2000, "Workout notes"));
            ExternalImportPath.At(dayPath + ".block", () => Validation.Text(day!.Block, 80, "Block"));
            ExternalImportPath.At(dayPath + ".phase", () => Validation.Text(day!.Phase, 120, "Phase"));
            ExternalImportPath.At(dayPath + ".phaseWeek", () => Validation.Require(day!.PhaseWeek is > 0 and <= 104, "Set the phase week between 1 and 104."));
            var id = Guid.NewGuid();
            ExternalImportPath.At(dayPath + ".key", () => Validation.Require(dayKeys.TryAdd(day!.Key, id), "Duplicate day key; give each day a unique key."));
            ExternalImportPath.Reference(dayPath + ".sourceReference", day!.SourceReference);
            ExternalImportPath.At(dayPath + ".exercises", () => Validation.Require(day!.Exercises is not null, "Add an exercises list to each day."));
            // Every exercise is converted before any failure is raised, so one upload reports all of them.
            var exercises = new List<DraftExercise>();
            var errorsBeforeDay = exerciseErrors.Count;
            foreach (var (exercise, index) in day!.Exercises!.Select((item, position) => (item, position)))
            {
                var exercisePath = $"{dayPath}.exercises[{index}]";
                var failures = ExternalImportPath.Collect(exercisePath, () => exercises.Add(ConvertExternalExercise(exercise, snapshot.Matches, exercisePath)));
                exerciseErrors.AddRange(failures.Take(ExternalImportLimits.MaxReportedErrors - exerciseErrors.Count));
            }
            // A failed exercise is missing from the list, so superset adjacency can only be judged for a clean day.
            if (exerciseErrors.Count == errorsBeforeDay) ExternalImportPath.At(dayPath + ".exercises", () => { foreach (var group in exercises.Select((exercise, index) => (exercise, index))
                .Where(item => !string.IsNullOrWhiteSpace(item.exercise.SequenceGroup))
                .GroupBy(item => item.exercise.SequenceGroup, StringComparer.OrdinalIgnoreCase))
            {
                var positions = group.Select(item => item.index).ToList();
                Validation.Require(positions.Count >= ExternalImportLimits.MinSupersetExercises, "Each superset must contain at least two exercises.");
                Validation.Require(positions[^1] - positions[0] + 1 == positions.Count,
                    "Exercises in a superset must be consecutive; give separate groups distinct labels.");
            } });
            days.Add(new DraftWorkout(id, day.Week, day.Name, day.Focus, day.Notes, exercises,
                day.Block, day.Phase, day.PhaseWeek, day.IsRestDay) { SourceReference = day.SourceReference });
        }
        if (exerciseErrors.Count > 0) throw ExternalImportPath.Aggregate(exerciseErrors);
        var groups = ExternalImportPath.At("$.program.alternativeGroups", () => ExternalGroups(source.AlternativeGroups, dayKeys));
        var draft = ImportValidation.NormalizeDraft(new ImportDraft(source.Name, days, source.SourceWeekDays) { AlternativeGroups = groups });
        // A phase's weeks count from one inside each run of that phase. A file that numbers them across the whole
        // program (an alternating Odd Week / Even Week schedule, say) uses a numbering convention, not a missing week;
        // the PDF reader renumbers it the same way, and the absolute weeks stay exactly as the file gave them.
        draft = draft with { Workouts = ImportValidation.NormalizePhaseWeeks(draft.Workouts).Workouts };
        foreach (var (day, index) in draft.Workouts.Select((item, index) => (item, index)))
        {
            var dayPath = $"$.program.days[{index}]";
            ExternalImportPath.At(dayPath + ".week", () => Validation.Require(day.Week is > 0 and <= 104, "Set the program week between 1 and 104."));
            await ExternalImportPath.AtAsync(dayPath, () => ImportValidation.ValidateWorkout(day, catalog, ct));
        }
        await ExternalImportPath.AtAsync("$.program.days", () => ValidateDraft(draft, ct));
        Validation.Name(fileName, "File name", 200);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        Validation.Require(!await db.Workouts.AnyAsync(workout => workout.Active, ct),
            "Finish or discard the active workout before importing a program.", 409);
        var import = new AiImport
        {
            UserId = db.CurrentUser!.Value, FileName = Path.GetFileName(fileName),
            PromptVersion = ImportDraftAlternatives.ExternalPromptVersion,
            Status = groups.Count > 0 ? ImportStatus.Pending : ImportStatus.Ready,
            Stage = groups.Count > 0 ? "select" : "done",
            Model = "external", DraftJson = Json.Write(draft),
            DraftBaselineJson = groups.Count > 0 ? "" : Json.Write(draft),
            AlternativesJson = Json.Write(groups.FirstOrDefault()?.Members ?? []),
            NoticesJson = Json.Write(new[] { new ImportReviewIssue("external_source_unverified",
                "WorkoutApp has not checked this import against the original source.", "info") })
        };
        UpdateCounters(import, draft);
        db.Imports.Add(import);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(import.Id, ct);
    }

    private static DraftExercise ConvertExternalExercise(ExternalExercise exercise, Dictionary<string, Guid> library, string path)
    {
        return ExternalImportPath.At(path, () => ConvertExternalExerciseAt(exercise, library, path));
    }

    private static DraftExercise ConvertExternalExerciseAt(ExternalExercise exercise, Dictionary<string, Guid> library, string path)
    {
        if (exercise is null) throw new DomainException("Add the missing exercise object.");
        ExternalImportPath.At(path + ".sourceName", () => Validation.Name(exercise.SourceName, "Exercise name", 160));
        ExternalImportPath.At(path + ".notes", () => Validation.Text(exercise.Notes, 1000, "Exercise notes"));
        ExternalImportPath.At(path + ".restSeconds", () => Validation.ExerciseRestSeconds(exercise.RestSeconds));
        ExternalImportPath.At(path + ".sequenceGroup", () => Validation.Text(exercise.SequenceGroup, 8, "Sequence group"));
        ExternalImportPath.At(path + ".sequenceGroup", () => Validation.Require(exercise.SequenceGroup is null || exercise.SequenceGroup == exercise.SequenceGroup.Trim(),
            "Remove spaces at the beginning and end of the superset label."));
        ExternalImportPath.At(path + ".sets", () => Validation.Require(exercise.Sets is not null, "Add a sets list to each exercise."));
        ExternalImportPath.Reference(path + ".sourceReference", exercise.SourceReference);
        ExternalImportPath.At(path + ".uncertainty", () => ImportUncertainty.Validate(exercise.Uncertainty));
        ExternalImportPath.At(path + ".substitutions", () => Validation.Substitutions(exercise.Substitutions));
        var sets = exercise.Sets!.Select((set, index) => {
            var setPath = $"{path}.sets[{index}]";
            return ExternalImportPath.At(setPath, () => ConvertExternalSet(set, setPath));
        }).ToList();
        foreach (var (set, index) in sets.Select((item, index) => (item, index)))
            ExternalImportPath.At($"{path}.sets[{index}]", () => Validation.Prescriptions([ImportValidation.ToPrescription(set)]));
        ExternalImportPath.At(path + ".sets", () => Validation.Prescriptions(sets.Select(ImportValidation.ToPrescription).ToList()));
        var demo = ExternalImportPath.At(path + ".demoUrl", () => CheckedDemo(exercise.DemoUrl));
        Dictionary<string, string>? links = null;
        if (exercise.DemoLinks is not null)
        {
            links = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            ExternalImportPath.At(path + ".demoLinks", () => {
                foreach (var (name, url) in exercise.DemoLinks)
                {
                    Validation.Name(name, "Demonstration link name", 160);
                    Validation.Require(!string.IsNullOrWhiteSpace(url), "Add a demonstration link or remove its empty entry.");
                    links.Add(name, CheckedDemo(url)!);
                }
            });
        }
        return new DraftExercise(Guid.NewGuid(), exercise.SourceName, CatalogMatching.Find(library, exercise.SourceName),
            exercise.Notes, sets, exercise.SequenceGroup ?? "", exercise.Substitutions, RestSeconds: exercise.RestSeconds,
            DemoUrl: demo, DemoLinks: links) { SourceReference = exercise.SourceReference, Uncertainty = exercise.Uncertainty };
    }

    private static string? CheckedDemo(string? url)
    {
        if (url is null) return null;
        var accepted = ImportDemoLinks.Video(url);
        Validation.Require(accepted is not null, "Use an approved host and a specific video or exercise guide for the demonstration link.");
        return accepted;
    }

    private static DraftSet ConvertExternalSet(ExternalSet set, string path)
    {
        if (set is null) throw new DomainException("Add the missing set object.");
        ExternalImportPath.Reference(path + ".sourceReference", set.SourceReference);
        ExternalImportPath.At(path + ".uncertainty", () => ImportUncertainty.Validate(set.Uncertainty));
        if (set.Rir is not null) ExternalImportPath.At(path + ".rir", () => {
            Validation.Text(set.Rir, 16, "RIR");
            Validation.Require(Regex.IsMatch(set.Rir, @"^\d{1,2}(?:\.\d+)?(?:\s*[-–]\s*\d{1,2}(?:\.\d+)?)?\+?$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)
                && Regex.Matches(set.Rir, @"\d+(?:\.\d+)?").Cast<Match>().All(match =>
                    double.TryParse(match.Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) && number <= ExternalImportLimits.MaxRir),
                "Use a numeric RIR or range between 0 and 10, optionally followed by +.");
        });
        var technique = ExternalImportPath.At(path + ".type", () => set.Type switch
        {
            null or "normal" or "warmup" => null,
            "dropset" => "Dropset", "amrap" => "AMRAP", "myoreps" => "Myo-reps",
            "partials" => "Partial reps", "lengthenedPartials" => "Lengthened partials",
            "integratedPartials" => "Integrated partials", "pause" => "Pause set",
            _ => throw new DomainException("Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause.")
        });
        ExternalImportPath.At(path + ".warmup", () => Validation.Require(!set.Warmup || set.Type is null or "warmup", "Use the warmup type for a warm-up set; it cannot have another set type."));
        var notes = technique is null ? set.Notes : string.IsNullOrWhiteSpace(set.Notes) ? technique : $"{set.Notes} — {technique}";
        var (targetRpe, rir, effortNote) = ExternalImportEffort.Express(set.TargetRpe, set.Rir);
        // A printed rest the file gives only as text ("1-2 MIN", "30SEC") still has to set the timer, as it does
        // for a PDF import. Seconds the file states win; text that is not a rest adds nothing.
        var restSeconds = set.RestSeconds ?? ImportTableEvidence.RestSecondsFromText(set.RestText);
        if (effortNote is not null) notes = string.IsNullOrWhiteSpace(notes) ? effortNote : $"{notes.Trim()} {effortNote}";
        Validation.Text(notes, 400, "Set notes");
        // A supplied value is marked "inferred": the file said it, and WorkoutApp has not checked it. A value the
        // file leaves out is "extracted" as absent. The PDF review reads "inferred" plus empty as a cell the model
        // failed to read and blocks on it, which would stop every file that omits a rest time or an effort target.
        string Source(bool supplied) => supplied ? "inferred" : "extracted";
        return new DraftSet(set.RepMin, set.RepMax, targetRpe, restSeconds, set.Tempo, set.LoadText, notes,
            Source(set.RepMin is not null || set.RepMax is not null), Source(targetRpe is not null), Source(restSeconds is not null),
            set.RepsText, set.RestText, rir, set.Warmup || set.Type == "warmup")
            { SourceReference = set.SourceReference, Uncertainty = set.Uncertainty };
    }
}
