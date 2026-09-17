using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Structural checks for everything the model returns, applied before a response is allowed
/// anywhere near a draft. A response that fails here is retryable: nothing has been written yet.
///
/// These are checks about the shape of a program — how many days, which weeks, which pages — not
/// about whether each written value fits the column that will hold it. Lengths, rep bounds, RPE
/// precision and rest are brought into range by `ImportNormalization` instead, because failing a
/// section over a long coaching note or a timed set with no rep count discards a transcription
/// that is otherwise faithful and leaves the import stuck on a section that fails identically on
/// every retry.
internal static class WorkoutAiValidation
{
    public static void Validate(AiOutline outline)
    {
        var chunks = outline.Chunks ?? [];
        var alternatives = outline.Alternatives ?? [];
        Validation.Require(alternatives.Count <= 12, "AI returned too many alternative programs in this PDF.", 422);
        Validation.Require(alternatives.Select(a => a.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() == alternatives.Count,
            "AI returned duplicate alternative program ids.", 422);
        Validation.Require(alternatives.Count <= 1 || chunks.Count == 0,
            "AI mixed alternative programs with an unscoped chunk list.", 422);
        Validation.Require(chunks is { Count: > 0 and <= 24 } || alternatives.Any(a => a.Chunks is { Count: > 0 }), "AI did not find usable program chunks in this PDF.", 422);
        foreach (var alternative in alternatives)
        {
            // The id is the key the browser sends back to choose this program, so it has to be
            // present and short; its prose is normalised like everything else.
            Validation.Name(alternative.Id, "Alternative id", 80);
            Validation.Require(alternative.Chunks is { Count: > 0 and <= 24 }, "AI returned an alternative without usable chunks.", 422);
        }
        foreach (var chunk in chunks.Concat(alternatives.SelectMany(a => a.Chunks ?? [])))
        {
            Validation.Require(chunk.WeekFrom is > 0 and <= 104 && chunk.WeekTo >= chunk.WeekFrom && chunk.WeekTo <= 104, "AI returned an invalid chunk week range.", 422);
            Validation.Require(chunk.PageFrom is > 0 and <= ImportSourceText.MaxPages && chunk.PageTo >= chunk.PageFrom && chunk.PageTo <= ImportSourceText.MaxPages, "AI returned an invalid chunk page range.", 422);
            Validation.Require(chunk.DayCount is > 0 and <= 80, "AI returned an invalid chunk size; split the phase into smaller semantic chunks.", 422);
        }
    }

    public static void Validate(AiProgram program)
    {
        var title = program.ProgramTitle ?? program.ProgramName;
        Validation.Name(title, "Program name");
        Validation.Text(program.Description, 4000, "Program description");
        if (program.Days is { } days)
        {
            Validation.Require(days is { Count: > 0 and <= 400 }, "AI did not find any training days in this PDF.", 422);
            foreach (var day in days)
            {
                Validation.Require(day.WeekNumber is > 0 and <= 104 && day.PhaseWeek is > 0 and <= 104, "AI returned an invalid week number.", 422);
                Validation.Require(day.Weekday is null || day.Weekday.Value is >= 1 and <= 7, "AI returned an invalid weekday.", 422);
                Validation.Require(day.SourcePage is null || day.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "AI returned an invalid source page.", 422);
                Validation.Require(day.IsRestDay ? day.Exercises is { Count: 0 } : day.Exercises is { Count: <= 40 }, "AI returned an invalid rest-day exercise list.", 422);
                foreach (var exercise in day.Exercises ?? []) Validate(exercise);
            }
            return;
        }

        Validation.Require(program.Weeks is { Count: > 0 and <= 104 }, "AI did not find any training weeks in this PDF.", 422);
        var workouts = program.Weeks!.Sum(w => w.Workouts?.Count ?? 0);
        Validation.Require(workouts is > 0 and <= 400, "This program is larger than the importer supports.", 422);
        foreach (var week in program.Weeks!)
        {
            Validation.Require(week.Week is > 0 and <= 104, "AI returned an invalid week number.", 422);
            foreach (var workout in week.Workouts ?? [])
            {
                Validation.Require(workout.Exercises is { Count: > 0 and <= 40 }, "AI returned a workout without usable exercises.", 422);
                foreach (var exercise in workout.Exercises!) Validate(exercise);
            }
        }
    }

    private static void Validate(AiExercise exercise)
    {
        Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "AI returned an invalid exercise source page.", 422);
        // A written program routinely offers three or four alternates for one movement. The draft
        // keeps the two an exercise can hold and records the rest in its note, so the length of
        // this list is never a reason to reject the section it came from.
        Validation.Require(exercise.Substitutions is null || exercise.Substitutions.Count <= 12,
            "AI returned an unusable substitution list.", 422);
        Validation.Require(exercise.Sets is { Count: > 0 and <= 24 }, "AI returned an exercise without usable sets.", 422);
        foreach (var set in exercise.Sets!)
        {
            Validation.Require(set.SourcePage is null || set.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "AI returned an invalid set source page.", 422);
            foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                Validation.Require(source is "extracted" or "inferred", "AI returned an unknown provenance label.", 422);
        }
    }
}
