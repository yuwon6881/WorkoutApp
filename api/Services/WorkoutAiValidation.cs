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

    /// A program the model returned. Almost nothing is required of it, and deliberately so: the
    /// response's shape is already guaranteed by the strict JSON schema, and every judgement a
    /// document can make that this app cannot store exactly — a movement listed with no sets, a
    /// page number miscounted, a session with more exercises
    /// than one day holds — is brought into shape by `ImportNormalization` and `ImportDayShape`
    /// and reported to the reviewer. Refusing any of it here throws away a read that has already
    /// been paid for and leaves the import failing identically on every retry.
    ///
    /// `section` says this is one section of a divided outline. A section can land on pages that
    /// document nothing — a photo spread at the end of a block — and that is a fact about those
    /// pages rather than a failed read, where a whole-document answer with no days at all means
    /// the importer genuinely found no program.
    public static void Validate(AiProgram program, bool section = false)
    {
        if (program.Days is { } days)
        {
            Validation.Require(section || days.Count > 0, "AI did not find any training days in this PDF.", 422);
            Validation.Require(days.Count <= 400, "This program is larger than the importer supports.", 422);
            return;
        }

        Validation.Require(program.Weeks is { Count: > 0 and <= 104 }, "AI did not find any training weeks in this PDF.", 422);
        var workouts = program.Weeks!.Sum(w => w.Workouts?.Count ?? 0);
        Validation.Require(workouts is > 0 and <= 400, "This program is larger than the importer supports.", 422);
    }
}
