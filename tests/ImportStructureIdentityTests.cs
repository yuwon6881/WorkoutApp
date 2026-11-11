using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The review editor saves only the days an exercise edit touched, and sends them with the week and
/// block identities it assigned. Days it did not touch have none yet; a week must stay one week.
public sealed class ImportStructureIdentityTests
{
    private const string Program = """
    {"version":1,"verified":true,"program":{"name":"Four day","days":[
      {"key":"w1-up","week":1,"name":"Upper","block":"Block 1","phaseWeek":1,"exercises":[{"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90}]}]},
      {"key":"w1-lo","week":1,"name":"Lower","block":"Block 1","phaseWeek":1,"exercises":[{"sourceName":"Seated Leg Curl","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90}]}]},
      {"key":"w2-up","week":2,"name":"Upper","block":"Block 1","phaseWeek":2,"exercises":[{"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90}]}]},
      {"key":"w2-lo","week":2,"name":"Lower","block":"Block 1","phaseWeek":2,"exercises":[{"sourceName":"Seated Leg Curl","sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90}]}]}
    ]}}
    """;

    [Fact]
    public async Task Saving_only_the_days_an_exercise_swap_touched_keeps_every_week_whole()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", null));
        var imports = h.Imports();
        var view = await imports.CreateExternalImport(Program, "p.json", default);
        var weekIds = view.Draft!.Workouts.Select(day => day.Week).Distinct().ToDictionary(week => week, _ => Guid.NewGuid());
        var blockId = Guid.NewGuid();

        var lowerDays = view.Draft.Workouts.Where(day => day.Name == "Lower")
            .Select(day => day with { WeekId = weekIds[day.Week], BlockId = blockId }).ToList();
        var saved = await imports.EditDays(view.Id, lowerDays, view.Revision, default);

        foreach (var week in saved.Draft!.Workouts.GroupBy(day => day.Week))
        {
            Assert.Single(week.Select(day => day.WeekId).Distinct());
            Assert.Single(week.Select(day => day.BlockId).Distinct());
        }
        Assert.Single(saved.Draft.Workouts.Select(day => day.BlockId).Distinct());
    }
}
