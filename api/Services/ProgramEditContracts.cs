using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// One day of a saved program as the editor holds it. An id that names a day of this program keeps
/// that day (its history, progress, and slot identities); any other id is a new day.
public record ProgramEditDayInput(Guid? Id, int Week, string Name, string? Focus, string? Note,
    List<TemplateExerciseInput> Exercises, string? Block = null, string? Phase = null, int PhaseWeek = 1,
    bool IsRestDay = false, int? SourcePage = null);

/// The whole edited program. Days are listed in order; a day's position in its week is its place
/// among the days that share its week number.
public record ProgramEditInput(string Name, int? Revision, List<ProgramEditDayInput> Days, Guid? IdempotencyId = null);

/// Compares a stored day with an edited one. The lock check uses the loose comparison, which looks
/// only at what a lifter sees and trains with, so provenance fields the editor does not carry can
/// never make an untouched past day look edited.
internal static class ProgramDayComparer
{
    private static string Text(string? value) => value?.Trim() ?? "";

    /// Blank and the default "Program" label name the same unnamed block.
    public static string BlockLabel(string? value)
    {
        var text = Text(value);
        return text.Length == 0 || text.Equals("Program", StringComparison.OrdinalIgnoreCase) ? "" : text;
    }

    public static bool Same(WorkoutTemplate day, IReadOnlyList<TemplateExercise> rows, ProgramEditDayInput input, bool strict)
    {
        if (Text(day.Name) != Text(input.Name) || Text(day.Focus) != Text(input.Focus) || Text(day.Note) != Text(input.Note)
            || BlockLabel(day.Block) != BlockLabel(input.Block) || Text(day.Phase) != Text(input.Phase)
            || day.IsRestDay != input.IsRestDay) return false;
        if (strict && (day.PhaseWeek != input.PhaseWeek || day.SourcePage != input.SourcePage)) return false;

        var stored = rows.OrderBy(row => row.Position).ToList();
        if (stored.Count != input.Exercises.Count) return false;
        for (var index = 0; index < stored.Count; index++)
            if (!SameExercise(stored[index], input.Exercises[index], strict)) return false;
        return true;
    }

    private static bool SameExercise(TemplateExercise row, TemplateExerciseInput input, bool strict)
    {
        if (row.ExerciseId != input.ExerciseId || Text(row.SourceName) != Text(input.SourceName)
            || Text(row.Note) != Text(input.Note) || Text(row.SequenceGroup) != Text(input.SequenceGroup)
            || row.RestSeconds != input.RestSeconds || (input.SlotKey is { } slot && slot != row.SlotKey)) return false;
        var sets = Json.Read<List<SetPrescription>>(row.SetsJson);
        if (sets.Count != input.Sets.Count) return false;
        for (var index = 0; index < sets.Count; index++)
            if (!SameSet(sets[index], input.Sets[index], strict)) return false;
        if (!strict) return true;
        var substitutions = Json.Read<List<string>>(row.SubstitutionsJson);
        var supplied = (input.Substitutions ?? []).Where(value => !string.IsNullOrWhiteSpace(value)).Select(Text).Take(2).ToList();
        return substitutions.SequenceEqual(supplied) && row.SourcePage == input.SourcePage;
    }

    private static bool SameSet(SetPrescription stored, SetPrescription input, bool strict)
        => stored.RepMin == input.RepMin && stored.RepMax == input.RepMax && stored.TargetRpe == input.TargetRpe
           && stored.RestSeconds == input.RestSeconds && Text(stored.Tempo) == Text(input.Tempo)
           && Text(stored.LoadText) == Text(input.LoadText) && Text(stored.Notes) == Text(input.Notes)
           && Text(stored.RepsText) == Text(input.RepsText) && Text(stored.RestText) == Text(input.RestText)
           && Text(stored.Rir) == Text(input.Rir) && stored.Warmup == input.Warmup
           && stored.ResistanceMode == input.ResistanceMode
           && (!strict || Json.Write(stored) == Json.Write(input));
}
