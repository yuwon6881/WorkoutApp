using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportedTimedCatalogLifecycleTests
{
    [Theory]
    [InlineData("flat-dumbbell-static-hold", "60 seconds")]
    [InlineData("dumbbell-lateral-raise-isometric-hold", "45 SEC")]
    [InlineData("squat-walk-out", "10-SEC")]
    [InlineData("stomach-vacuum", "10-15 sec hold")]
    public async Task Shipped_timed_movements_start_log_and_finish_as_seconds(string slug, string target)
    {
        var path = CatalogPath();
        var row = Assert.Single(Json.Read<List<SeedExercise>>(File.ReadAllText(path)), item => item.Slug == slug);
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(row);
        var id = await h.ExerciseId(slug);
        var input = new TemplateInput("Timed", null, null,
            [new TemplateExerciseInput(id, row.Name, null,
                [new SetPrescription(null, null, 8, 60, null, null, null, RepsText: target)])], null, null);
        var template = await h.Templates.Create(input, null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var exercise = Assert.Single(session.Exercises);
        Assert.Equal(TrackingModes.Duration, exercise.TrackingMode);
        Assert.Null(Assert.Single(exercise.Sets).Reps);
        Assert.Equal(target, Assert.Single(exercise.Prescription).RepsText);
        using var patch = JsonDocument.Parse($$"""
            {"revision":{{session.Revision}},"mutationId":"{{Guid.NewGuid()}}","durationSeconds":10,"done":true}
            """);
        var logged = await h.Workouts.PatchSet(session.Id, exercise.Sets.Single().Id, patch.RootElement.Clone(), default);
        var finished = await h.Workouts.Finish(session.Id, logged.Revision, default);
        Assert.Equal(10, finished.Exercises.Single().Sets.Single().DurationSeconds);
        Assert.Null(finished.VolumeKg);
        Assert.False(finished.Exercises.Single().IsPr);
    }

    private static string CatalogPath()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            DirectoryInfo? current = new(start);
            while (current is not null)
            {
                var candidate = Path.Combine(current.FullName, "deploy", "exercises.json");
                if (File.Exists(candidate)) return candidate;
                current = current.Parent;
            }
        }
        throw new InvalidOperationException("deploy/exercises.json was not found.");
    }
}
