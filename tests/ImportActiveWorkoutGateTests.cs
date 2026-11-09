using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// An import ends by rewriting the account's programs and the days a session can be started from,
/// so a file may not be converted into a draft while a workout is open.
public sealed class ImportActiveWorkoutGateTests
{
    private static async Task<(Harness h, Guid templateId)> Ready()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);
        return (h, template.Id);
    }

    private static Task<ImportView> Import(ImportService imports)
        => ExternalDraftFixture.Create(imports, ExternalDraftFixture.Weeks(1));

    [Fact]
    public async Task An_import_cannot_start_while_a_workout_is_open()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await h.Workouts.Start(templateId, null, default);
        var imports = h.Imports();

        var failure = await Assert.ThrowsAsync<DomainException>(() => Import(imports));

        Assert.Equal(409, failure.Status);
        Assert.Contains("active workout", failure.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await imports.List(default));
    }

    [Fact]
    public async Task An_import_can_start_once_the_workout_is_finished()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                exercise.Sets.Select(_ => new SetInput(60, 10, 8, true)).ToList())], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);

        var draft = await Import(h.Imports());

        Assert.Equal(ImportStatus.Ready, draft.Status);
    }

    [Fact]
    public async Task An_import_can_start_once_the_workout_is_discarded()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Discard(session.Id, default);

        var draft = await Import(h.Imports());

        Assert.Equal(ImportStatus.Ready, draft.Status);
    }
}
