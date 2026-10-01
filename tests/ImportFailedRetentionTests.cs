using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A failed import is a past attempt, not work in progress. It stays briefly so its explanation can
/// be read, then it leaves on its own instead of resurfacing on the import screen for weeks.
public sealed class ImportFailedRetentionTests
{
    private static Dictionary<string, string?> Configured => new() { ["OpenAi:ApiKey"] = "test-key", ["OpenAi:Model"] = "gpt-5.4-mini" };

    private static ImportSourceInput Source(string fileName) => new(fileName, 2, Enumerable.Range(1, 2)
        .Select(page => new ImportPageText(page, $"WEEK {page}\nBarbell bench press 3 x 8-10 @ RPE 8")).ToList());

    private const string OneWorkout = """
    {"programName":"Hypertrophy block","weeks":[
      {"week":1,"workouts":[{"name":"Day A","focus":"Push","notes":null,"exercises":[
        {"sourceName":"Barbell bench press","exerciseId":null,"notes":null,"sets":[
          {"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,
           "repsSource":"extracted","rpeSource":"inferred","restSource":"extracted"}]}]}]}]}
    """;

    private static AiImport FailedRow(Guid userId, string fileName, DateTime created) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, Status = ImportStatus.Failed, Stage = "failed",
        FileName = fileName, Error = "The read could not be completed.", Created = created
    };

    [Fact] public async Task A_failed_import_older_than_a_day_is_no_longer_listed_and_is_swept()
    {
        await using var h = await Harness.Create(Configured);
        var user = await h.SignIn();
        var now = DateTime.UtcNow;
        var stale = FailedRow(user.Id, "The_Min-Max_Program__5X.pdf", now.AddDays(-15));
        var recent = FailedRow(user.Id, "Recent.pdf", now.AddHours(-2));
        h.Db.Imports.AddRange(stale, recent);
        await h.Db.SaveChangesAsync();
        var imports = h.Imports(StubHandler.Program(OneWorkout));

        var listed = Assert.Single(await imports.List(default));
        Assert.Equal(recent.Id, listed.Id);

        await imports.CleanupExpired(default);
        var rows = await h.Db.Imports.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(recent.Id, Assert.Single(rows).Id);
    }

    [Fact] public async Task Importing_the_same_pdf_again_replaces_its_earlier_failed_attempts()
    {
        await using var h = await Harness.Create(Configured);
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Barbell bench press", "Chest", "Barbell", "Cue", null));
        var imports = h.Imports(StubHandler.Program(OneWorkout));
        var first = await imports.Create(Source("The_Min-Max_Program__5X.pdf"), default);
        var row = await h.Db.Imports.SingleAsync(import => import.Id == first.Id);
        row.Status = ImportStatus.Failed;
        row.Error = "The read could not be completed.";
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();
        var unrelated = await imports.Create(Source("Unrelated.pdf") with
        {
            Pages = [new ImportPageText(1, "WEEK 1\nBarbell bench press 4 x 6 @ RPE 7"), new ImportPageText(2, "WEEK 2")]
        }, default);

        var second = await imports.Create(Source("The_Min-Max_Program__5X.pdf"), default);

        Assert.NotEqual(first.Id, second.Id);
        var listed = await imports.List(default);
        Assert.DoesNotContain(listed, view => view.Id == first.Id);
        Assert.Contains(listed, view => view.Id == second.Id);
        Assert.Contains(listed, view => view.Id == unrelated.Id);
    }
}
