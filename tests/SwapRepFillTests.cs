using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A swap re-aims the unlogged sets for the replacement. Reps that only held the replaced
/// exercise's fill take the replacement's own, so a set never shows the new exercise's target over
/// the old exercise's count; reps the lifter typed stay.
public sealed class SwapRepFillTests
{
    [Fact]
    public async Task A_swap_fills_the_replacements_reps_where_the_original_fill_was_untouched()
    {
        await using var h = await Harness.Create();
        var (template, curl, curlRepFill) = await Prepare(h);

        var session = await h.Workouts.Start(template, null, default);
        Assert.All(session.Exercises.Single().Sets, set => Assert.Equal(curlRepFill, set.Reps));
        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(session.Exercises[0].Id, curl, "Lying leg curl", session.Revision, null), default);

        var sets = swapped.Exercises.Single().Sets;
        Assert.All(sets, set => Assert.Equal(set.Suggestion!.SuggestedReps, set.Reps));
        Assert.All(sets, set => Assert.NotEqual(curlRepFill, set.Reps));
    }

    [Fact]
    public async Task A_swap_keeps_reps_the_lifter_typed()
    {
        await using var h = await Harness.Create();
        var (template, curl, curlRepFill) = await Prepare(h);

        var session = await h.Workouts.Start(template, null, default);
        var exercise = session.Exercises.Single();
        var typed = curlRepFill + 3;
        var edited = await h.Workouts.Save(session.Id, new SessionInput(null, [Input(exercise, [
            Keep(exercise.Sets[0]), Keep(exercise.Sets[1], reps: typed)])], session.Revision, null), default);
        var swapped = await h.Workouts.Swap(session.Id, new SessionSubstitutionInput(exercise.Id, curl, "Lying leg curl", edited.Revision, null), default);

        var sets = swapped.Exercises.Single().Sets;
        Assert.Equal(sets[0].Suggestion!.SuggestedReps, sets[0].Reps);
        Assert.Equal(typed, sets[1].Reps);
    }

    /// Nordic curls last time sat low in a 6-12 range; leg curls topped it. The two exercises'
    /// suggestions then ask for different rep counts at the start of the next session.
    private static async Task<(Guid Template, Guid Curl, int? NordicRepFill)> Prepare(Harness h)
    {
        await h.SignIn();
        await h.Seed(
            new SeedExercise("nordic", "Nordic ham curl", "Hamstrings", "Machine", null),
            new SeedExercise("curl", "Lying leg curl", "Hamstrings", "Machine", null));
        var nordic = await h.ExerciseId("nordic"); var curl = await h.ExerciseId("curl");
        var nordicTemplate = await h.Templates.Create(Harness.Template("Legs",
            Harness.Exercise(nordic, "Nordic ham curl", Harness.Set(6, 12), Harness.Set(6, 12))), null, 1, 0, default);
        var curlTemplate = await h.Templates.Create(Harness.Template("Curls",
            Harness.Exercise(curl, "Lying leg curl", Harness.Set(6, 12), Harness.Set(6, 12))), null, 1, 0, default);

        await Finish(h, curlTemplate.Id, 40, 12);
        await Finish(h, nordicTemplate.Id, 20, 6);

        var probe = await h.Workouts.Start(nordicTemplate.Id, null, default);
        var nordicFill = probe.Exercises.Single().Sets[0].Reps;
        await h.Workouts.Discard(probe.Id, default);
        return (nordicTemplate.Id, curl, nordicFill);
    }

    private static async Task Finish(Harness h, Guid template, double load, int reps)
    {
        var session = await h.Workouts.Start(template, null, default);
        var exercise = session.Exercises.Single();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null, [Input(exercise,
            exercise.Sets.Select(set => new SetInput(load, reps, 8, true, Id: set.Id)).ToList())], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, saved.Revision, default);
    }

    private static SessionExerciseInput Input(SessionExerciseView exercise, List<SetInput> sets)
        => new(exercise.ExerciseId, exercise.Name, exercise.Note, exercise.Prescription, sets, exercise.SequenceGroup, exercise.Substitutions,
            exercise.LoadModel, exercise.Id, exercise.SourceTemplateExerciseId, exercise.SourceSlotKey, exercise.SourcePhaseId);

    private static SetInput Keep(SetView set, int? reps = null)
        => new(set.WeightKg, reps ?? set.Reps, set.Rpe, set.Done, set.Warmup, set.ResistanceMode, set.Id);
}
