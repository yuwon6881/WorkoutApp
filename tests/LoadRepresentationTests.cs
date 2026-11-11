using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// One physical weight can be stored two ways: a pound entry rounded to a gram by the web client,
/// and the same pounds unrounded from the watch or a prefilled suggestion. Neither is a load change.
public sealed class LoadRepresentationTests
{
    private const double PoundsPerKg = 2.2046226218;

    [Theory]
    [InlineData(15)]
    [InlineData(45)]
    [InlineData(100)]
    [InlineData(225)]
    [InlineData(315)]
    public void A_pound_load_rounded_to_a_gram_is_the_same_load_as_its_unrounded_kilograms(double pounds)
    {
        var exact = pounds / PoundsPerKg;
        var rounded = Math.Round(exact * 1000) / 1000;

        Assert.True(ProgressionEvidence.SameLoad(exact, rounded));
        // The smallest real jump (half a pound) is still a different load.
        Assert.False(ProgressionEvidence.SameLoad(exact, (pounds + .5) / PoundsPerKg));
    }

    [Fact]
    public async Task Progression_reads_a_rounded_and_an_unrounded_entry_of_one_weight_as_one_streak()
    {
        var exact = 225 / PoundsPerKg;
        var rounded = Math.Round(exact * 1000) / 1000;

        var consistent = await NextLoadAfter(exact, exact);
        var mixed = await NextLoadAfter(rounded, exact);

        Assert.NotNull(consistent);
        Assert.Equal(consistent!.Value, mixed!.Value, 2);
    }

    [Fact]
    public void A_custom_plate_loaded_machine_is_a_machine_that_needs_plates()
    {
        Assert.Equal(["plates"], GymEquipment.ForEquipment("Plate-Loaded Machine"));
        Assert.Equal(ExerciseCategories.Machine, ExerciseCategories.Normalize(null, equipment: "Plate-Loaded Machine"));
    }

    private static async Task<double?> NextLoadAfter(double firstKg, double secondKg)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("press", "Bench Press", "Chest", "Barbell", null));
        var id = await h.ExerciseId("press");
        var template = (await h.Templates.Create(Harness.Template("Day", Harness.Exercise(id, "Bench Press", Harness.Set(8, 10))), null, 1, 0, default)).Id;
        foreach (var kg in new[] { firstKg, secondKg })
        {
            var session = await h.Workouts.Start(template, null, default);
            var exercise = session.Exercises.Single();
            await h.Workouts.Save(session.Id, new SessionInput(null,
                [new SessionExerciseInput(id, "Bench Press", null, exercise.Prescription,
                    [new SetInput(kg, 10, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
                session.Revision, null), default);
            await h.Workouts.Finish(session.Id, null, default);
        }
        var next = await h.Workouts.Start(template, null, default);
        return next.Exercises.Single().Sets[0].WeightKg;
    }
}
