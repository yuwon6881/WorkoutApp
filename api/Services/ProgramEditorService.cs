using System.Text;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record ProgramEditorCreateInput(ImportDraft Draft, Guid? IdempotencyId = null);

/// Validation and one-shot materialization for a program authored in the builder. The document is
/// held in the browser until the lifter asks for the program, so nothing half-built is stored.
public sealed class ProgramEditorService(ProgramService programs)
{
    private const int MaxJsonBytes = 1_048_576;

    public async Task<ProgramView> CreateProgram(ProgramEditorCreateInput input, CancellationToken ct)
    {
        var draft = input.Draft;
        SerializeAndValidate(draft);
        ValidateCreationReadiness(draft);
        var programInput = new ProgramInput(draft.ProgramName,
            draft.Workouts.Select(workout => new ProgramWorkoutInput(workout.Week, workout.Name,
                workout.Focus, workout.Notes,
                workout.Exercises.Select(exercise => new TemplateExerciseInput(exercise.ExerciseId,
                    exercise.SourceName, exercise.Notes,
                    exercise.Sets.Select(ToPrescription).ToList(), exercise.SequenceGroup,
                    exercise.Substitutions, exercise.SourcePage, exercise.SlotKey, exercise.RestSeconds)).ToList(),
                workout.Block, workout.Phase, workout.PhaseWeek, workout.IsRestDay, workout.SourcePage)).ToList(),
            input.IdempotencyId);

        // A program built by hand starts on standby: the lifter chooses when it becomes the one
        // they are running.
        return await programs.Create(programInput, activate: false, sourceImportId: null, ct);
    }

    private static SetPrescription ToPrescription(DraftSet set)
        => new(set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.LoadText,
            set.Notes, set.RepsText, set.RestText, set.Rir, set.Warmup, set.RepsSource,
            set.RpeSource, set.RestSource, ResistanceModes.External, set.SourcePage);

    private static string SerializeAndValidate(ImportDraft? draft)
    {
        Validation.Require(draft is not null, "A program draft is required.");
        Validation.Text(draft!.ProgramName, 120, "Program name");
        var workouts = draft.Workouts ?? throw new DomainException("A draft must include its workout list.");
        Validation.Require(workouts.Count <= 400, "A draft can contain at most 400 workout days.");
        Validation.Require(workouts.All(workout => workout is not null), "A workout day is missing.");
        Validation.Require(workouts.All(workout => workout.Week is > 0 and <= 104),
            "Draft weeks must be between 1 and 104.");
        Validation.Require(workouts.GroupBy(workout => workout.Week).All(week => week.Count() <= 7),
            "A week can contain at most 7 workout days.");
        Validation.Require(workouts.All(workout => workout.PhaseWeek is > 0 and <= 104),
            "Phase weeks must be between 1 and 104.");

        var workoutIds = new HashSet<Guid>();
        var exerciseIds = new HashSet<Guid>();
        var weekIdentityNumbers = new Dictionary<Guid, int>();
        var blockIdentityNames = new Dictionary<Guid, string>();
        var closedBlockIds = new HashSet<Guid>();
        Guid? previousBlockId = null;
        foreach (var week in workouts.GroupBy(workout => workout.Week).OrderBy(group => group.Key))
        {
            var days = week.ToList();
            var suppliedWeekIds = days.Where(day => day.WeekId is not null).Select(day => day.WeekId!.Value).Distinct().ToList();
            Validation.Require(suppliedWeekIds.Count == 1 && days.All(day => day.WeekId is not null),
                "Every day in a week must share one week identity.");
            var weekId = suppliedWeekIds[0];
            Validation.Require(weekId != Guid.Empty, "A week identity is invalid.");
            if (weekIdentityNumbers.TryGetValue(weekId, out var assignedWeek))
                Validation.Require(assignedWeek == week.Key, "A week identity cannot refer to different weeks.");
            else weekIdentityNumbers.Add(weekId, week.Key);

            var suppliedBlockIds = days.Where(day => day.BlockId is not null).Select(day => day.BlockId!.Value).Distinct().ToList();
            Validation.Require(suppliedBlockIds.Count == 1 && days.All(day => day.BlockId is not null),
                "Every day in a week must share one block identity.");
            var blockId = suppliedBlockIds[0];
            Validation.Require(blockId != Guid.Empty, "A block identity is invalid.");
            var blockName = days[0].Block?.Trim() ?? "";
            if (blockIdentityNames.TryGetValue(blockId, out var assignedName))
                Validation.Require(string.Equals(assignedName, blockName, StringComparison.Ordinal),
                    "A block identity cannot refer to different block names.");
            else blockIdentityNames.Add(blockId, blockName);

            if (previousBlockId is { } previous && previous != blockId)
                closedBlockIds.Add(previous);
            Validation.Require(!closedBlockIds.Contains(blockId), "Weeks in a block must remain contiguous.");
            previousBlockId = blockId;
        }

        foreach (var workout in workouts)
        {
            Validation.Require(workout.LineId != Guid.Empty && workoutIds.Add(workout.LineId),
                "Each workout day must have a unique identity.");
            Validation.Text(workout.Name, 120, "Workout name");
            Validation.Text(workout.Focus, 120, "Focus");
            Validation.Text(workout.Notes, 2000, "Workout notes");
            Validation.Text(workout.Block, 80, "Block");
            Validation.Text(workout.Phase, 120, "Phase");
            var exercises = workout.Exercises ?? throw new DomainException("A workout must include its exercise list.");
            Validation.Require(exercises.Count <= 40, "A workout can contain at most 40 exercises.");
            Validation.Require(exercises.All(exercise => exercise is not null), "An exercise is missing.");
            foreach (var exercise in exercises)
            {
                Validation.Require(exercise.LineId != Guid.Empty && exerciseIds.Add(exercise.LineId),
                    "Each exercise must have a unique identity.");
                Validation.Text(exercise.SourceName, 160, "Exercise name");
                Validation.Text(exercise.Notes, 1000, "Exercise notes");
                Validation.Text(exercise.SequenceGroup, 8, "Sequence group");
                Validation.Require(exercise.Substitutions is null || exercise.Substitutions.Count <= 2,
                    "An exercise can contain at most 2 substitutions.");
                var sets = exercise.Sets ?? throw new DomainException("An exercise must include its set list.");
                Validation.Require(sets.Count <= 24, "An exercise can contain at most 24 sets.");
                Validation.Require(sets.All(set => set is not null), "A set is missing.");
                foreach (var set in sets)
                {
                    Validation.Text(set.Tempo, 24, "Tempo");
                    Validation.Text(set.LoadText, 60, "Load");
                    Validation.Text(set.Notes, 400, "Set notes");
                    Validation.Text(set.RepsText, 40, "Verbatim reps");
                    Validation.Text(set.RestText, 24, "Verbatim rest");
                    Validation.Text(set.Rir, 16, "RIR");
                }
            }
        }

        var json = Json.Write(draft);
        Validation.Require(Encoding.UTF8.GetByteCount(json) <= MaxJsonBytes,
            "That draft is larger than the 1 MB limit.", 413);
        return json;
    }

    private static void ValidateCreationReadiness(ImportDraft draft)
    {
        var weeks = draft.Workouts.Select(workout => workout.Week).Distinct().Order().ToList();
        Validation.Require(weeks.Count > 0 && weeks.SequenceEqual(Enumerable.Range(1, weeks[^1])),
            "Program weeks must be contiguous and start at week 1.", 422);
        var blockNames = draft.Workouts.GroupBy(workout => workout.BlockId!.Value)
            .Select(group => group.First().Block?.Trim() ?? "").ToList();
        Validation.Require(blockNames.Distinct(StringComparer.OrdinalIgnoreCase).Count() == blockNames.Count,
            "Each block needs a different name so its weeks remain separate.", 422);
        foreach (var workout in draft.Workouts.Where(workout => !workout.IsRestDay))
            foreach (var exercise in workout.Exercises)
                Validation.Require(exercise.ExerciseId is not null,
                    "Choose an exercise from the library for every training-day exercise before creating the program.", 422);
    }
}
