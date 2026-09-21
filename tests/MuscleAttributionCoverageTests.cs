using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class MuscleAttributionCoverageTests
{
    [Fact]
    public async Task Every_shipped_catalog_row_resolves_only_to_supported_regions()
    {
        var catalogPath = Path.Combine(RepositoryRoot(), "deploy", "exercises.json");
        var exercises = Json.Read<List<SeedExercise>>(await File.ReadAllTextAsync(catalogPath));

        Assert.NotEmpty(exercises);
        foreach (var exercise in exercises)
        {
            var credits = MuscleAttribution.For(exercise.Name, exercise.Muscle, exercise.SecondaryMuscles);
            Assert.True(credits.Count > 0, $"{exercise.Slug} ({exercise.Muscle}) produced no muscle attribution.");
            Assert.All(credits, credit =>
                Assert.Contains(credit.Region, MuscleRegions.All));
        }
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "cloudbuild.yaml")) &&
                File.Exists(Path.Combine(directory.FullName, "WorkoutApp.slnx")) &&
                Directory.Exists(Path.Combine(directory.FullName, "api"))) return directory.FullName;
        throw new DirectoryNotFoundException("WorkoutApp repository root was not found.");
    }
}
