using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class PercentageProgramStartTests
{
    [Fact]
    public async Task Relative_backoff_does_not_use_an_estimated_one_rep_max()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("bench");
        var plan = Harness.Set(10, 20) with { LoadText = "60%", Notes = PercentageLoad.PriorSetNote };
        var template = await h.Templates.Create(Harness.Template("Day", Harness.Exercise(id, "Bench", plan)), null, 1, 0, default);
        await Log(h, template.Id, id, "Bench", 90, 1);
        var started = await h.Workouts.Start(template.Id, null, default);
        var set = started.Exercises.Single().Sets.Single();
        Assert.Null(set.WeightKg);
        Assert.Contains("earlier set", set.Suggestion!.Reason);
    }

    [Fact]
    public async Task Previously_imported_top_set_instruction_is_honoured_at_start()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("bench");
        var plan = Harness.Set(10, 20) with { LoadText = "60%" };
        var exercise = Harness.Exercise(id, "Bench", plan) with { Note = "Use ~60% of the weight you used on your top set." };
        var template = await h.Templates.Create(Harness.Template("Day", exercise), null, 1, 0, default);
        await Log(h, template.Id, id, "Bench", 90, 1);
        var started = await h.Workouts.Start(template.Id, null, default);
        Assert.Null(started.Exercises.Single().Sets.Single().WeightKg);
        Assert.Contains(PercentageLoad.PriorSetNote, started.Exercises.Single().Prescription.Single().Notes);
        var stored = h.Db.SessionExercises.Single(row => row.Id == started.Exercises.Single().Id);
        stored.PrescriptionJson = Json.Write(new List<SetPrescription> { plan });
        await h.Db.SaveChangesAsync();
        var reopened = await h.Workouts.Get(started.Id, default);
        Assert.Contains(PercentageLoad.PriorSetNote, reopened.Exercises.Single().Prescription.Single().Notes);
    }
    private static async Task<(Harness H, Guid ExerciseId, Guid TemplateId)> Setup(string load)
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Squat", "Quads", "Barbell", null, 2.5));
        var id = await h.ExerciseId("squat");
        var plan = Harness.Set(5, 5) with { LoadText = load };
        var template = await h.Templates.Create(Harness.Template("Legs", Harness.Exercise(id, "Squat", plan)), null, 1, 0, default);
        return (h, id, template.Id);
    }

    [Fact]
    public async Task Legacy_manual_max_is_preserved_but_never_used_for_the_workout()
    {
        var (h, id, template) = await Setup("75%");
        await using var _ = h;
        await AddLegacyMax(h, id);

        var unknown = await h.Workouts.Start(template, null, default);
        Assert.Null(unknown.Exercises.Single().Sets.Single().WeightKg);
        await h.Workouts.Discard(unknown.Id, default);

        await Log(h, template, id, "Squat", 100, 5);
        var started = await h.Workouts.Start(template, null, default);
        Assert.Equal(92.5, started.Exercises.Single().Sets.Single().WeightKg);
        Assert.Equal(200, await ReadLegacyMax(h));
    }

    [Fact]
    public async Task Swapping_a_percentage_exercise_uses_replacement_history_not_its_legacy_max()
    {
        var (h, _, template) = await Setup("75%");
        await using var _ = h;
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null, 2.5));
        var bench = await h.ExerciseId("bench");
        await AddLegacyMax(h, bench);
        var benchTemplate = await h.Templates.Create(Harness.Template("Bench", Harness.Exercise(bench, "Bench", Harness.Set(5, 5))), null, 1, 0, default);

        var first = await h.Workouts.Start(template, null, default);
        var unknown = await h.Workouts.Swap(first.Id,
            new SessionSubstitutionInput(first.Exercises.Single().Id, bench, "Bench", first.Revision, null), default);
        Assert.Null(unknown.Exercises.Single().Sets.Single().WeightKg);
        await h.Workouts.Discard(first.Id, default);

        await Log(h, benchTemplate.Id, bench, "Bench", 100, 5);
        var next = await h.Workouts.Start(template, null, default);
        var swapped = await h.Workouts.Swap(next.Id,
            new SessionSubstitutionInput(next.Exercises.Single().Id, bench, "Bench", next.Revision, null), default);
        var set = swapped.Exercises.Single().Sets.Single();
        Assert.Equal(92.5, set.WeightKg);
        Assert.Contains("estimated 1RM", set.Suggestion!.Reason);
        Assert.Equal(200, await ReadLegacyMax(h));
    }

    [Fact]
    public async Task A_percentage_set_has_no_load_until_a_one_rep_max_is_known_then_follows_it()
    {
        var (h, id, template) = await Setup("75%");
        await using var _ = h;

        var unknown = await h.Workouts.Start(template, null, default);
        Assert.Null(unknown.Exercises.Single().Sets.Single().WeightKg);
        await h.Workouts.Discard(unknown.Id, default);

        await Log(h, template, id, "Squat", 120, 3);
        var started = await h.Workouts.Start(template, null, default);
        Assert.Equal(105, started.Exercises.Single().Sets.Single().WeightKg);
        await h.Workouts.Discard(started.Id, default);
    }

    [Fact]
    public async Task The_estimate_from_a_logged_heavy_set_is_used()
    {
        var (h, id, template) = await Setup("75%");
        await using var _ = h;
        var first = await h.Workouts.Start(template, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Squat", null, exercise.Prescription,
                [new SetInput(100, 5, 8, true, Id: exercise.Sets.Single().Id)], Id: exercise.Id)], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var next = await h.Workouts.Start(template, null, default);
        var set = next.Exercises.Single().Sets.Single();
        Assert.Equal(92.5, set.WeightKg);
        Assert.Contains("estimated 1RM", set.Suggestion!.Reason);
    }

    private static async Task AddLegacyMax(Harness h, Guid exerciseId)
    {
        await h.Db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "ExerciseOneRepMaxes" (
                "UserId" TEXT NOT NULL, "Id" TEXT NOT NULL,
                "OneRepMaxKg" REAL NOT NULL, "Revision" INTEGER NOT NULL,
                PRIMARY KEY ("UserId", "Id"))
            """);
        await h.Db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "ExerciseOneRepMaxes" ("UserId", "Id", "OneRepMaxKg", "Revision")
            VALUES ({h.Db.CurrentUser!.Value}, {exerciseId}, {200.0}, {1})
            """);
    }

    private static async Task<double> ReadLegacyMax(Harness h)
    {
        await using var command = h.Db.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT \"OneRepMaxKg\" FROM \"ExerciseOneRepMaxes\"";
        return Convert.ToDouble(await command.ExecuteScalarAsync());
    }

    private static async Task Log(Harness h, Guid templateId, Guid exerciseId, string name, double load, int reps)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single(row => row.Name == name);
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exerciseId, name, null, exercise.Prescription,
                [new SetInput(load, reps, 8, true, Id: exercise.Sets.First().Id)], Id: exercise.Id)], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    [Fact]
    public async Task A_heavier_percentage_is_not_capped_at_the_lighter_set_before_it()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench", "Chest", "Barbell", null, 2.5));
        var id = await h.ExerciseId("bench");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(id, "Bench",
            Harness.Set(3, 3, 8.5) with { LoadText = "80%" },
            Harness.Set(3, 3, 8.5) with { LoadText = "85%" },
            Harness.Set(3, 3, 8.5) with { LoadText = "70%" })), null, 1, 0, default);
        await Log(h, template.Id, id, "Bench", 90, 1);

        var started = await h.Workouts.Start(template.Id, null, default);

        Assert.Equal([80, 85, 70], started.Exercises.Single().Sets.Select(set => set.WeightKg!.Value));
    }

    [Fact]
    public async Task Next_weeks_percentage_sets_the_load_not_last_weeks_logged_load()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Squat", "Quads", "Barbell", null, 2.5));
        var id = await h.ExerciseId("squat");
        var week1 = await h.Templates.Create(Harness.Template("W1", Harness.Exercise(id, "Squat", Harness.Set(5, 5) with { LoadText = "70%" })), null, 1, 0, default);
        var week2 = await h.Templates.Create(Harness.Template("W2", Harness.Exercise(id, "Squat", Harness.Set(5, 5) with { LoadText = "80%" })), null, 1, 0, default);

        await Log(h, week1.Id, id, "Squat", 120, 3);
        await Log(h, week1.Id, id, "Squat", 97.5, 5);
        var next = await h.Workouts.Start(week2.Id, null, default);

        Assert.Equal(112.5, next.Exercises.Single().Sets.Single().WeightKg);
    }

    [Fact]
    public async Task An_unknown_one_rep_max_leaves_the_load_blank_even_with_logged_history_and_says_what_is_needed()
    {
        var (h, id, template) = await Setup("75%");
        await using var _ = h;
        await Log(h, template, id, "Squat", 60, 15);

        var next = await h.Workouts.Start(template, null, default);
        var set = next.Exercises.Single().Sets.Single();

        Assert.Null(set.WeightKg);
        Assert.Contains("recent heavy set", set.Suggestion!.Reason);
    }

    [Fact]
    public async Task An_accessory_without_a_percentage_keeps_ordinary_progression_beside_a_percentage_lift()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Squat", "Quads", "Barbell", null, 2.5),
            new SeedExercise("curl", "Curl", "Biceps", "Dumbbell", null, 2));
        var squat = await h.ExerciseId("squat");
        var curl = await h.ExerciseId("curl");
        var template = await h.Templates.Create(Harness.Template("Day",
            Harness.Exercise(squat, "Squat", Harness.Set(5, 5) with { LoadText = "75%" }),
            Harness.Exercise(curl, "Curl", Harness.Set(8, 12))), null, 1, 0, default);

        await Log(h, template.Id, squat, "Squat", 120, 3);
        await Log(h, template.Id, curl, "Curl", 20, 12);
        var next = await h.Workouts.Start(template.Id, null, default);

        var squatSet = next.Exercises.Single(row => row.Name == "Squat").Sets.Single();
        var curlSet = next.Exercises.Single(row => row.Name == "Curl").Sets.Single();
        Assert.Equal(105, squatSet.WeightKg);
        Assert.DoesNotContain("1RM", curlSet.Suggestion!.Reason);
        Assert.True(curlSet.WeightKg >= 20, $"expected progression from 20 kg, got {curlSet.WeightKg}");
    }
}
