using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Shape checks for everything the model returns, applied before a response is allowed anywhere
/// near a draft. A response that fails here is retryable: nothing has been written yet.
internal static class WorkoutAiValidation
{
    public static void Validate(AiOutline outline)
    {
        Validation.Name(outline.ProgramTitle, "Program name");
        Validation.Text(outline.Description, 4000, "Program description");
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
            Validation.Name(alternative.Id, "Alternative id", 80); Validation.Name(alternative.Name, "Alternative name", 200);
            Validation.Text(alternative.Description, 4000, "Alternative description");
            Validation.Require(alternative.Chunks is { Count: > 0 and <= 24 }, "AI returned an alternative without usable chunks.", 422);
        }
        foreach (var chunk in chunks.Concat(alternatives.SelectMany(a => a.Chunks ?? [])))
        {
            Validation.Name(chunk.Label, "Chunk label", 200);
            Validation.Text(chunk.Block, 80, "Block"); Validation.Text(chunk.Phase, 120, "Phase");
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
                Validation.Name(day.DayName, "Workout name");
                Validation.Text(day.Block, 80, "Block"); Validation.Text(day.Phase, 120, "Phase"); Validation.Text(day.Notes, 2000, "Workout notes");
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
                Validation.Name(workout.Name, "Workout name");
                Validation.Require(workout.Exercises is { Count: > 0 and <= 40 }, "AI returned a workout without usable exercises.", 422);
                foreach (var exercise in workout.Exercises!) Validate(exercise);
            }
        }
    }

    private static void Validate(AiExercise exercise)
    {
        Validation.Name(exercise.SourceName, "Exercise name", 160);
            Validation.Text(exercise.Notes, 1000, "Exercise notes"); Validation.Text(exercise.CoachingNotes, 1000, "Coaching notes");
            Validation.Require(exercise.SourcePage is null || exercise.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "AI returned an invalid exercise source page.", 422);
        Validation.Text(exercise.SequenceGroup, 8, "Sequence group"); Validation.Substitutions(exercise.Substitutions);
        Validation.Require(exercise.Sets is { Count: > 0 and <= 24 }, "AI returned an exercise without usable sets.", 422);
        foreach (var set in exercise.Sets!)
        {
            Validation.Require(set.RepMin is > 0 and <= 1000 && set.RepMax is > 0 and <= 1000 && set.RepMin <= set.RepMax, "AI returned an invalid rep range.", 422);
            if (set.TargetRpe is { } target) Validation.Rpe(target, "Target RPE");
            if (set.RestSeconds is { } rest) Validation.Require(rest is >= 0 and <= 3600, "AI returned an invalid rest time.", 422);
            Validation.Require(set.SourcePage is null || set.SourcePage.Value is > 0 and <= ImportSourceText.MaxPages, "AI returned an invalid set source page.", 422);
            Validation.Text(set.RepsText, 40, "Verbatim reps"); Validation.Text(set.RestText, 24, "Verbatim rest");
            Validation.Text(set.Percent1Rm, 24, "%1RM"); Validation.Text(set.Rir, 16, "RIR");
            foreach (var source in new[] { set.RepsSource, set.RpeSource, set.RestSource })
                Validation.Require(source is "extracted" or "inferred", "AI returned an unknown provenance label.", 422);
        }
    }
}
