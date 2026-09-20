using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportMinMaxRegressionTests
{
    private static readonly (string Name, string[] Exercises)[] Schedule =
    [
        ("Upper 1", [
            "Barbell Incline Press", "Pec Deck", "Incline DB Y-Raise", "Pull-Up (Wide Grip)",
            "Kelso Shrug", "EZ-Bar Preacher Curl", "Triceps Pressdown", "Dragon Flag"
        ]),
        ("Lower 1", [
            "Lying Leg Curl", "Squat (Your Choice)", "Smith Machine Lunge", "Leg Extension",
            "Machine Hip Abduction", "Standing Calf Raise"
        ]),
        ("Rest Day", []),
        ("Upper 2", [
            "Close-Grip Lat Pulldown", "Chest-Supported T-Bar Row", "Machine Shrug", "Machine Chest Press",
            "High-Cable Lateral Raise", "1-Arm Reverse Pec Deck", "Cable Crunch"
        ]),
        ("Lower 2", [
            "Leg Extension", "Barbell RDL", "Machine Hip Thrust", "Leg Press", "Standing Calf Raise"
        ]),
        ("Arms/Delts", [
            "Bayesian Cable Curl", "Overhead Cable Triceps Extension", "Modified Zottman Curl",
            "Cable Triceps Kickback", "DB Wrist Curl", "DB Wrist Extension", "Alternating DB Curl",
            "Machine Lateral Raise", "Dead Hang (optional)"
        ]),
        ("Rest Day", [])
    ];

    [Fact]
    public async Task Min_max_source_reconciliation_preserves_the_12_week_schedule_and_only_the_genuine_choice_blocks()
    {
        await using var harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["OpenAi:ApiKey"] = "test-key",
            ["OpenAi:Model"] = "gpt-5.4-mini"
        });
        await harness.SignIn();
        var catalogPath = Path.Combine(RepositoryRoot(), "deploy", "exercises.json");
        var catalog = Json.Read<List<SeedExercise>>(await File.ReadAllTextAsync(catalogPath));
        await harness.Seed(catalog.ToArray());

        var pages = new List<ImportPageText>();
        var days = new List<AiDay>();
        var page = 0;
        for (var week = 1; week <= 12; week++)
        {
            foreach (var (dayName, sourceExercises) in Schedule)
            {
                page++;
                var block = week <= 6 ? 1 : 2;
                var lines = new List<string> { $"BLOCK {block}" };
                if (week == 1) lines.Add("INTRO WEEK");
                if (week == 7) lines.Add("DELOAD WEEK");
                lines.Add($"WEEK {week}");
                lines.Add(dayName);

                var modelExercises = new List<AiExercise>();
                if (sourceExercises.Length > 0)
                {
                    lines.Add("Exercise | Working Sets | Reps | RIR Set 1 | RIR Set 2 | Rest");
                    foreach (var sourceName in sourceExercises)
                    {
                        var workingSets = WorkingSets(sourceName);
                        var reps = sourceName == "Dead Hang (optional)" ? "N/A" : "6-8";
                        var firstRir = sourceName == "Squat (Your Choice)" ? "3" : "2";
                        var secondRir = workingSets == 1 ? "N/A" : "1";
                        lines.Add($"{sourceName} | {workingSets} | {reps} | {firstRir} | {secondRir} | 2 min");

                        modelExercises.Add(new AiExercise(ModelName(sourceName), null, null,
                            [new AiSet(1, 1, null, null, null, null, null, RpeSource: "inferred", SourcePage: page)],
                            SourcePage: page));
                    }
                }

                pages.Add(new ImportPageText(page, string.Join('\n', lines)));
                days.Add(new AiDay("Block 99", "Base", week, 1, dayName, sourceExercises.Length == 0, null,
                    modelExercises, page));
            }
        }

        var sourceProgram = new AiProgram("The Min-Max Program", days, ProgramName: "Min-Max");
        var sourceText = ImportSourceText.Slice(pages, 1, ImportSourceText.MaxPages);
        var reconciledProgram = ImportTableEvidence.Enrich(sourceProgram, sourceText);
        var reconciledDays = reconciledProgram.Days ?? throw new InvalidOperationException("Expected a day-based Min-Max draft.");
        Assert.Equal("1-Arm Reverse Pec Deck", reconciledDays.Single(day => day.SourcePage == 4).Exercises[5].SourceName);
        Assert.Equal("Leg Press", reconciledDays.Single(day => day.SourcePage == 5).Exercises[3].SourceName);
        Assert.Equal("Cable Triceps Kickback", reconciledDays.Single(day => day.SourcePage == 6).Exercises[3].SourceName);
        var imports = harness.Imports(StubHandler.Program(Json.Write(sourceProgram)));
        var view = await imports.Create(new ImportSourceInput("min-max.pdf", pages.Count, pages), default);

        Assert.Equal(ImportStatus.Ready, view.Status);
        var draft = Assert.IsType<ImportDraft>(view.Draft);
        Assert.Equal(84, draft.Workouts.Count);
        Assert.Equal(Enumerable.Range(1, 12), draft.Workouts.Select(workout => workout.Week).Distinct().Order());
        Assert.Equal(60, draft.Workouts.Count(workout => !workout.IsRestDay));
        Assert.Equal(24, draft.Workouts.Count(workout => workout.IsRestDay));

        var exercises = draft.Workouts.SelectMany(workout => workout.Exercises).ToList();
        Assert.Equal(420, exercises.Count);
        var expectedNames = Schedule.SelectMany(day => day.Exercises).ToHashSet(StringComparer.Ordinal);
        var actualNames = exercises.Select(exercise => exercise.SourceName).ToHashSet(StringComparer.Ordinal);
        Assert.Empty(expectedNames.Except(actualNames));
        Assert.Empty(actualNames.Except(expectedNames));
        Assert.DoesNotContain(exercises, exercise => exercise.SourceName is "Exercise" or "Rest Day" or "Suggested Rest Day" or "Mandatory Rest Day"
            || exercise.SourceName.StartsWith("Substitution", StringComparison.OrdinalIgnoreCase)
            || exercise.SourceName.Equals("N/A", StringComparison.OrdinalIgnoreCase));

        var choiceRows = exercises.Where(exercise => exercise.SourceName == "Squat (Your Choice)").ToList();
        Assert.Equal(12, choiceRows.Count);
        Assert.Single(choiceRows.Select(exercise => exercise.SlotKey).Distinct());
        var choice = Assert.Single(view.Unresolved);
        Assert.Equal("Squat (Your Choice)", choice.SourceName);
        Assert.Equal(12, choice.Occurrences);
        Assert.Null(choice.Block);
        Assert.Equal(408, exercises.Count(exercise => exercise.ExerciseId is not null));
        Assert.All(exercises.Where(exercise => exercise.SourceName != "Squat (Your Choice)"),
            exercise => Assert.NotNull(exercise.ExerciseId));

        Assert.Equal(["Block 1", "Block 2"], draft.Workouts.Select(workout => workout.Block).Distinct().Order());
        Assert.Equal("Intro Week", draft.Workouts.First(workout => workout.Week == 1).Phase);
        Assert.Equal("Deload Week", draft.Workouts.First(workout => workout.Week == 7).Phase);
        Assert.All(draft.Workouts.Where(workout => workout.Week is not (1 or 7)), workout => Assert.Null(workout.Phase));

        var repairedLegPress = exercises.Where(exercise => exercise.SourceName == "Leg Press").ToList();
        Assert.Equal(12, repairedLegPress.Count);
        Assert.All(repairedLegPress, exercise =>
        {
            var set = Assert.Single(exercise.Sets);
            Assert.Equal("6-8", set.RepsText);
            Assert.Equal("2", set.Rir);
            Assert.Equal(8, set.TargetRpe);
            Assert.Equal(120, set.RestSeconds);
        });

        Assert.DoesNotContain(view.ReviewIssues ?? [], issue => issue.Code is "duplicate_day_dropped" or "chunk_day_count"
            or "rpe_unspecified" or "rest_unspecified" or "week_day_overflow");
        Assert.DoesNotContain(view.ReviewIssues ?? [], issue => issue.Severity != "info");
        Assert.False(view.Acceptable);
    }

    private static int WorkingSets(string name) => name switch
    {
        "Smith Machine Lunge" or "Machine Hip Abduction" or "Machine Shrug" or "1-Arm Reverse Pec Deck"
            or "Leg Press" or "Modified Zottman Curl" or "Alternating DB Curl" => 1,
        _ => 2
    };

    private static string ModelName(string sourceName) => sourceName switch
    {
        "1-Arm Reverse Pec Deck" => "Reverse Pec Deck One Arm",
        "Leg Press" => "Smith Machine Squat",
        "Cable Triceps Kickback" => "Cable Triceps Kickback Machine",
        _ => sourceName
    };

    private static string RepositoryRoot()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            DirectoryInfo? current = new(start);
            while (current is not null)
            {
                if (File.Exists(Path.Combine(current.FullName, "deploy", "exercises.json"))) return current.FullName;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Could not locate the WorkoutApp repository root.");
    }
}
