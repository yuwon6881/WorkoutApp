using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class AppDbSaveTests
{
    [Fact]
    public async Task A_save_that_fails_after_its_rows_are_written_keeps_the_changes_pending()
    {
        var failures = new FailingCommands();
        await using var h = await Harness.Create(observer: failures);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var bench = await h.ExerciseId("bench");
        var created = await h.Programs.Create(new ProgramInput("Original",
            [new ProgramWorkoutInput(1, "Day", "Strength", null, [Harness.Exercise(bench, "Bench press", Harness.Set(8, 10))])]),
            false, null, default);
        var program = await h.Db.Programs.SingleAsync(candidate => candidate.Id == created.Id);

        // The generation bump runs after the program row is written, inside the same transaction.
        program.Name = "Renamed";
        failures.Fails = command => command.CommandText.Contains("INSERT INTO \"ResourceGenerations\"");
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Db.SaveChangesAsync());

        Assert.Equal(EntityState.Modified, h.Db.Entry(program).State);
        Assert.Equal("Original", await h.Db.Programs.AsNoTracking()
            .Where(candidate => candidate.Id == created.Id).Select(candidate => candidate.Name).SingleAsync());

        failures.Fails = _ => false;
        await h.Db.SaveChangesAsync();
        Assert.Equal(EntityState.Unchanged, h.Db.Entry(program).State);
        Assert.Equal("Renamed", await h.Db.Programs.AsNoTracking()
            .Where(candidate => candidate.Id == created.Id).Select(candidate => candidate.Name).SingleAsync());
    }
}
