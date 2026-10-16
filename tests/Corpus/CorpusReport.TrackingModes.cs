using System.Text.RegularExpressions;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests.Corpus;

public sealed partial class CorpusReport
{
    [Fact]
    public async Task Printed_timed_targets_match_duration_catalog_entries()
    {
        var folder = Environment.GetEnvironmentVariable("WORKOUT_PDF_CORPUS");
        if (string.IsNullOrWhiteSpace(folder)) return;
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed([.. Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()))]);
        var library = await harness.Catalog.MatchIndex(default);
        var entries = (await harness.Catalog.All(default)).ToDictionary(entry => entry.Id);
        var checks = new List<object>();
        var failures = new List<string>();
        foreach (var path in Directory.GetFiles(folder, "*.draft"))
        {
            var draft = Json.Read<ImportDraft>(File.ReadAllText(path));
            foreach (var exercise in draft.Workouts.SelectMany(day => day.Exercises))
            {
                var timed = exercise.Sets.Any(set => !set.Warmup && Regex.IsMatch(set.RepsText ?? "",
                    @"\b(?:secs?|seconds?|mins?|minutes?)\b|\d+s\b|^\d{0,2}:\d{2}$", RegexOptions.IgnoreCase));
                if (!timed) continue;
                var id = CatalogMatching.Find(library, exercise.SourceName);
                var entry = id is { } resolved ? entries.GetValueOrDefault(resolved) : null;
                checks.Add(new { pdf = Path.GetFileName(path), exercise.SourceName, catalogName = entry?.Name,
                    trackingMode = entry?.TrackingMode });
                if (entry?.TrackingMode != TrackingModes.Duration)
                    failures.Add($"{Path.GetFileName(path)} p.{exercise.SourcePage}: {exercise.SourceName} -> {entry?.Name ?? "unresolved"} ({entry?.TrackingMode})");
            }
        }
        var output = Path.Combine(folder, "spot-checks");
        Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output, "round5-duration-mappings.json"), Json.Write(checks));
        Assert.NotEmpty(checks);
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }
}
