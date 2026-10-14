using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// One edited day paired with the stored day it keeps, if any.
internal sealed record PlannedDay(ProgramEditDayInput Input, WorkoutTemplate? Stored, bool Locked, bool ContentChanged);

/// Decides whether an edited program respects what the active run has already used up, before a
/// single row is written. Every refusal names the day or week it protects.
internal static class ProgramEditPlan
{
    public static List<PlannedDay> Build(ProgramEditInput input, IReadOnlyList<WorkoutTemplate> stored,
        ILookup<Guid, TemplateExercise> rows, ProgramLockState locks)
    {
        var storedById = stored.ToDictionary(day => day.Id);
        var seen = new HashSet<Guid>();
        var planned = new List<PlannedDay>(input.Days.Count);
        foreach (var day in input.Days)
        {
            WorkoutTemplate? match = null;
            if (day.Id is { } id && storedById.TryGetValue(id, out var found))
            {
                Validation.Require(seen.Add(id), "A day appears more than once in this program.");
                match = found;
            }
            planned.Add(Plan(day, match, rows, locks));
        }

        foreach (var day in stored.Where(day => !seen.Contains(day.Id)))
        {
            Validation.Require(!locks.IsLocked(day), $"{Describe(day)} is already past, so it can't be removed.", 409);
            Validation.Require(!locks.IsPinned(day.Id),
                $"{Describe(day)} has a workout in progress. Finish or discard it before removing the day.", 409);
        }

        RequireLockedOrderKept(planned, stored, locks);
        if (locks.RunInProgress)
            Validation.Require(planned.Any(day => day.Input.Week == locks.CurrentWeek),
                $"Week {locks.CurrentWeek} is in progress and needs at least one day.", 422);

        ProgramService.ValidateStructure(planned.Select(Merged).ToList());
        return planned;
    }

    private static PlannedDay Plan(ProgramEditDayInput day, WorkoutTemplate? match,
        ILookup<Guid, TemplateExercise> rows, ProgramLockState locks)
    {
        if (match is null)
        {
            RequireOpenWeek(day.Week, locks);
            return new PlannedDay(day, null, false, true);
        }

        var dayRows = rows[match.Id].ToList();
        if (locks.IsLocked(match))
        {
            Validation.Require(day.Week == match.Week && ProgramDayComparer.Same(match, dayRows, day, strict: false),
                $"{Describe(match)} is already past, so it can't be changed.", 409);
            return new PlannedDay(day, match, true, false);
        }

        RequireOpenWeek(day.Week, locks);
        Validation.Require(!locks.IsPinned(match.Id) || day.Week == match.Week,
            $"{Describe(match)} has a workout in progress, so it can't move to another week.", 409);
        return new PlannedDay(day, match, false, !ProgramDayComparer.Same(match, dayRows, day, strict: true));
    }

    private static void RequireOpenWeek(int week, ProgramLockState locks)
        => Validation.Require(!locks.RunInProgress || week >= locks.CurrentWeek,
            $"Weeks before Week {locks.CurrentWeek} are already past, so days can't be added or moved into them.", 409);

    /// Past days may sit among new ones, but they keep the order they were done in.
    private static void RequireLockedOrderKept(List<PlannedDay> planned, IReadOnlyList<WorkoutTemplate> stored, ProgramLockState locks)
    {
        foreach (var week in planned.Where(day => day.Locked).GroupBy(day => day.Input.Week))
        {
            var edited = week.Select(day => day.Stored!.Id).ToList();
            var original = stored.Where(day => locks.IsLocked(day) && day.Week == week.Key)
                .OrderBy(day => day.Position).Select(day => day.Id).ToList();
            Validation.Require(edited.SequenceEqual(original),
                $"Days already past in Week {week.Key} can't be reordered.", 409);
        }
    }

    /// The day as it will be stored: a past day keeps its stored labels whatever the editor sent.
    private static ProgramWorkoutInput Merged(PlannedDay day)
        => day.Stored is { } stored && day.Locked
            ? new ProgramWorkoutInput(stored.Week, stored.Name, stored.Focus, stored.Note, [], ProgramDayComparer.BlockLabel(stored.Block), stored.Phase,
                stored.PhaseWeek, stored.IsRestDay, stored.SourcePage)
            : new ProgramWorkoutInput(day.Input.Week, day.Input.Name, day.Input.Focus, day.Input.Note, [],
                ProgramDayComparer.BlockLabel(day.Input.Block), day.Input.Phase, day.Input.PhaseWeek,
                day.Input.IsRestDay, day.Input.SourcePage);

    private static string Describe(WorkoutTemplate day) => $"Week {day.Week} \"{day.Name}\"";
}
