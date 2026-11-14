using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The seed file is the source of every exercise's main muscle, so a movement must never be filed under
/// a group that names a muscle it does not train (a calf raise under "Traps, calves, and hips").
public sealed class CatalogMusclePlausibilityTests
{
    private static List<SeedExercise> Seed()
        => Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogLocation.Path()));

    [Fact]
    public void Every_calf_movement_trains_the_calves()
    {
        var calf = Seed().Where(row => row.Name.Contains("Calf", StringComparison.OrdinalIgnoreCase) ||
            row.Name.Contains("Toe Press", StringComparison.OrdinalIgnoreCase)).ToList();

        Assert.NotEmpty(calf);
        Assert.All(calf, row => Assert.Equal("Calves", row.Muscle));
    }

    [Fact]
    public void No_exercise_is_filed_under_a_group_of_unrelated_muscles()
    {
        var mixed = Seed().Where(row => row.Muscle is "Traps, calves, and hips" or "Adductors and neck")
            .Select(row => row.Name).ToList();

        Assert.Empty(mixed);
    }

    [Theory]
    [InlineData("seated-calf-raise", "calf_raise")]
    [InlineData("leg-press-calf-press", "calf_raise")]
    [InlineData("hanging-leg-raise", "trunk_flexion_or_anti_extension")]
    [InlineData("plate-loaded-lying-leg-curl", "knee_flexion")]
    [InlineData("leg-extension", "knee_extension")]
    [InlineData("lateral-raise", "shoulder_isolation")]
    [InlineData("ez-bar-curl", "elbow_flexion")]
    public void A_movement_pattern_names_the_joint_the_movement_works(string slug, string pattern)
        => Assert.Equal(pattern, CatalogSeed.CuratedMovementPattern(slug));
}
