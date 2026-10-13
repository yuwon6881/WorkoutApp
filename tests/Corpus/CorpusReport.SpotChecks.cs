using System.Text.Json;
using System.Text.Json.Nodes;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests.Corpus;

public sealed partial class CorpusReport
{
    [Theory]
    [InlineData("Arm_Hypertrophy_Program")]
    [InlineData("Powerbuilding_2.0_5-6xweek")]
    [InlineData("Powerbuilding-3.0_5xweek")]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_4xweek")]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_5xweek")]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_6xweek")]
    public Task SpotCheck_sixth_round_source_fidelity(string key) =>
        SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(key, null, null);

    [Theory]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_5xweek")]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_6xweek")]
    [InlineData("The_Pure_Bodybuilding_Program_-_PPL")]
    [InlineData("High_Frequency_Full_Body_Program_4xweek")]
    [InlineData("Powerbuilding_2.0_4xweek")]
    [InlineData("Chest_Hypertrophy_Program")]
    [InlineData("Shoulder_Hypertrophy_Program")]
    public Task SpotCheck_fifth_round_source_fidelity(string key) =>
        SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(key, null, null);

    [Theory]
    [InlineData("The_Essentials_Program_-_5xweek")]
    [InlineData("Intermediate_Advanced_PPL_Program_6xweek")]
    [InlineData("Upper_Lower_Program_6xweek")]
    [InlineData("Pure_Bodybuilding_Phase_2_-_Full_Body")]
    [InlineData("The_Bodybuilding_Transformation_System_-_Beginner")]
    [InlineData("Powerbuilding_2.0_5-6xweek")]
    public Task SpotCheck_fourth_round_source_fidelity(string key) =>
        SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(key, null, null);

    [Theory]
    [InlineData("Forearm_Hypertrophy_Program")]
    [InlineData("Back_Hypertrophy_Program")]
    [InlineData("Chest_Hypertrophy_Program")]
    [InlineData("Squat_Specialization_Program")]
    [InlineData("Pure_Bodybuilding_Phase_2_-_Upper_Lower")]
    [InlineData("The_Min-Max_Program__5X")]
    public Task SpotCheck_third_round_source_fidelity(string key) =>
        SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(key, null, null);

    [Theory]
    [InlineData("Arm_Hypertrophy_Program")]
    [InlineData("Neck_and_Trap_Guide")]
    [InlineData("Bench_Press_Specialization_Program")]
    [InlineData("High_Frequency_Full_Body_Program_5xweek")]
    [InlineData("The_Bodybuilding_Transformation_System_-_Intermediate_Advanced")]
    public Task SpotCheck_additional_pdf_layouts_recover_faulty_reads_and_repeated_descriptions(string key) =>
        SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(key, null, null);

    [Theory]
    [InlineData("Powerbuilding_3.0_4xweek", null, "week-a")]
    [InlineData("Powerbuilding_3.0_4xweek", null, "week-b")]
    [InlineData("Fundamentals_Hypertrophy_Program", "full-body-program", null)]
    [InlineData("Fundamentals_Hypertrophy_Program", "upper-lower-program", null)]
    [InlineData("Fundamentals_Hypertrophy_Program", "bodypart-program", null)]
    [InlineData("Purebodybuilding_Phase_2_-_PPL", null, null)]
    [InlineData("The_Ultimate_Push_Pull_Legs_System_-_4xweek", null, null)]
    [InlineData("The_Min-Max_Phase2_Program__5X.pdf", null, null)]
    [InlineData("Shoulder_Hypertrophy_Program", null, null)]
    public async Task SpotCheck_complex_pdfs_recover_faulty_reads_and_repeated_descriptions(
        string key, string? programChoice, string? weekChoice)
    {
        var folder = Environment.GetEnvironmentVariable("WORKOUT_PDF_SPOTCHECKS");
        if (string.IsNullOrWhiteSpace(folder)) return;
        var file = Path.Combine(folder, key + ".json");
        Assert.True(File.Exists(file), $"Missing source fixture: {key}");
        var catalog = Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()));
        var normal = await Replay(file, catalog, drifting: false, selectedAlternativeId: programChoice,
            weekChoiceId: weekChoice);
        var duplicated = 0;
        var stress = await Replay(file, catalog, drifting: true, selectedAlternativeId: programChoice,
            weekChoiceId: weekChoice, transformAnswer: (_, answer) => DuplicateDescriptions(answer, ref duplicated));
        var failures = new List<string>();
        Assert.True(normal.View.Status == "ready", $"Normal {key}: {normal.View.Status}: {normal.View.Error}");
        Assert.True(stress.View.Status == "ready", $"Stress {key}: {stress.View.Status}: {stress.View.Error}");
        if (key == "Arm_Hypertrophy_Program")
        {
            var finalFailure = normal.View.Draft!.Workouts.SelectMany(day => day.Exercises)
                .Where(exercise => exercise.SourceName is "STANDING EZ BAR CURL" or "MEDICINE BALL PUSHUPS").ToList();
            Assert.Equal(16, finalFailure.Count);
            Assert.All(finalFailure, exercise =>
            {
                var working = exercise.Sets.Where(set => !set.Warmup).ToList();
                Assert.All(working.Take(working.Count - 1), set => Assert.Equal(9, set.TargetRpe));
                Assert.Equal(10, working[^1].TargetRpe);
                Assert.Equal("0", working[^1].Rir);
            });
            var carries = normal.View.Draft!.Workouts.SelectMany(day => day.Exercises)
                .Where(exercise => exercise.SourceName == "FARMERS WALKS").ToList();
            Assert.Equal(8, carries.Count);
            Assert.Equal(24, carries.Sum(exercise => exercise.Sets.Count));
            Assert.All(carries.SelectMany(exercise => exercise.Sets), set => Assert.Equal("40 strides", set.RepsText));
        }
        if (key.StartsWith("The_Ultimate_Push_Pull_Legs_System", StringComparison.Ordinal))
        {
            var feeders = normal.View.Draft!.Workouts.SelectMany(day => day.Exercises)
                .Where(exercise => exercise.SourceName == "Lat Pulldown (Feeder Sets)").ToList();
            Assert.Equal(6, feeders.Count);
            Assert.All(feeders, exercise =>
            {
                Assert.Equal(new double?[] { null, 7, 8, 10 }, exercise.Sets.Select(set => set.TargetRpe));
                Assert.Equal(["5+", "3", "2", "0"], exercise.Sets.Select(set => set.Rir));
                Assert.All(exercise.Sets, set => Assert.False(set.Warmup));
            });
        }
        if (key == "Shoulder_Hypertrophy_Program")
        {
            var descriptions = normal.View.Draft!.Workouts.SelectMany(day => day.Exercises)
                .Select(exercise => exercise.Notes ?? "").ToList();
            Assert.Equal(8, descriptions.Count(note => note.Contains("LEAN INTO DIRECTION", StringComparison.OrdinalIgnoreCase)));
            Assert.Equal(8, descriptions.Count(note => note.Contains("STAND IN THE MIDDLE", StringComparison.OrdinalIgnoreCase)));
            Assert.Equal(4, descriptions.Count(note => note.Contains("SHORT ROM \"PULSES\"", StringComparison.OrdinalIgnoreCase)));
        }
        CompareSemantics(normal.View.Draft, normal.CanonicalNames, stress.View.Draft, stress.CanonicalNames,
            key, failures);
        var report = new
        {
            key, programChoice, weekChoice, duplicatedModelDescriptions = duplicated,
            normalStatus = normal.View.Status, stressStatus = stress.View.Status,
            weeks = stress.View.Draft!.Workouts.Select(day => day.Week).Distinct().Count(),
            daysPerWeek = stress.View.Draft.Workouts.GroupBy(day => day.Week).Select(week => week.Count()),
            exercises = stress.View.Draft.Workouts.Sum(day => day.Exercises.Count),
            sets = stress.View.Draft.Workouts.Sum(day => day.Exercises.Sum(exercise => exercise.Sets.Count)),
            issues = stress.View.ReviewIssues,
            semanticDifferences = failures
        };
        var output = Path.Combine(folder, "spot-checks");
        Directory.CreateDirectory(output);
        if (Environment.GetEnvironmentVariable("WORKOUT_CORPUS_DUMP") == "1")
        {
            var choice = programChoice ?? weekChoice;
            var suffix = choice is null ? "" : $".{choice}";
            File.WriteAllText(Path.Combine(folder, $"{key}{suffix}.draft"), Json.Write(normal.View.Draft));
            File.WriteAllText(Path.Combine(folder, $"{key}{suffix}.drift.draft"), Json.Write(stress.View.Draft));
        }
        File.WriteAllText(Path.Combine(output, $"{key}.{programChoice ?? weekChoice ?? "default"}.json"), Json.Write(report));
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    [Theory]
    [InlineData("week-a")]
    [InlineData("week-b")]
    public async Task SpotCheck_other_powerbuilding_pdf_keeps_all_weeks_after_a_misleading_outline(string choice)
    {
        var folder = Environment.GetEnvironmentVariable("WORKOUT_PDF_SPOTCHECKS");
        if (string.IsNullOrWhiteSpace(folder)) return;
        var file = Path.Combine(folder, "Powerbuilding_3.0_4xweek.json");
        using var source = JsonDocument.Parse(File.ReadAllText(file));
        var pages = source.RootElement.GetProperty("pages").EnumerateArray().Select(page =>
            new ImportPageText(page.GetProperty("page").GetInt32(), page.GetProperty("text").GetString()!)).ToList();
        var variants = ImportWeekVariants.PageVersions(pages);
        var outline = new AiOutline("Powerbuilding 3.0", [], variants.GroupBy(item => item.Value.Version)
            .Select(group => new AiAlternative($"option-{group.Key.ToLowerInvariant()}", $"Week {group.First().Value.Week}{group.Key}",
                [new AiOutlineChunk($"Week {group.First().Value.Week}{group.Key}", null, null,
                    group.First().Value.Week, group.First().Value.Week, group.Min(item => item.Key), group.Max(item => item.Key), 3)]))
            .ToList());
        Assert.Equal(2, outline.Alternatives!.Count);
        Assert.Empty(ImportAlternativeReconciliation.Reconcile(outline, pages).Alternatives);
        var catalog = Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()));
        var baseline = await Replay(file, catalog, drifting: false, selectedAlternativeId: null, weekChoiceId: choice);
        var recovered = await Replay(file, catalog, drifting: false, selectedAlternativeId: null,
            weekChoiceId: choice, outlineOverride: outline);
        Assert.True(recovered.View.Status == "ready", $"{recovered.View.Status}: {recovered.View.Error}");
        var failures = new List<string>();
        CompareSemantics(baseline.View.Draft, baseline.CanonicalNames,
            recovered.View.Draft! with { ProgramName = baseline.View.Draft!.ProgramName }, recovered.CanonicalNames,
            $"Misleading {choice}", failures);
        Assert.Equal(Enumerable.Range(1, 10), recovered.View.Draft!.Workouts.Select(day => day.Week).Distinct());
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    private static string DuplicateDescriptions(string answer, ref int duplicated)
    {
        var root = JsonNode.Parse(answer)!;
        if (root["days"] is not JsonArray days) return answer;
        foreach (var day in days)
        {
            if (day?["exercises"] is not JsonArray exercises) continue;
            foreach (var exercise in exercises)
            {
                if (exercise?["coachingNotes"]?.GetValue<string>() is not { Length: > 0 } note
                    || exercise["notes"] is not null) continue;
                exercise["notes"] = note;
                duplicated++;
            }
        }
        return root.ToJsonString();
    }
}
