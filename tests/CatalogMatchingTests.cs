using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A program writes movements the way a coach says them and the library stores one canonical name
/// each. Exact spelling was the only thing that matched, so a real import arrived with over a
/// hundred names unlinked — "Pull-Up (Wide Grip)" never found "Pull Up" — and every one had to be
/// mapped by hand. What is matched here is a different spelling of the same movement, never a
/// judgement that two movements are near enough.
public sealed class CatalogMatchingTests
{
    private static async Task<(Harness h, CatalogService catalog)> Library()
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("pull-up", "Pull Up", "Back", "Bodyweight", "Cue", null),
            new SeedExercise("incline-press", "Dumbbell Incline Press", "Chest", "Dumbbell", "Cue", null),
            new SeedExercise("lat-pulldown", "Lat Pulldown", "Back", "Cable", "Cue", null),
            new SeedExercise("preacher-curl", "Preacher Curl", "Biceps", "Barbell", "Cue", null),
            new SeedExercise("squat", "Squat", "Legs", "Barbell", "Cue", null));
        return (h, h.Catalog);
    }

    [Theory]
    // A grip, stance or tempo noted in brackets is the same movement written more precisely.
    [InlineData("Pull-Up (Wide Grip)", "Pull Up")]
    [InlineData("Lat Pulldown (Wide Grip)", "Lat Pulldown")]
    // Equipment as a table abbreviates it.
    [InlineData("DB Incline Press", "Dumbbell Incline Press")]
    // The same words written plurally.
    [InlineData("Preacher Curls", "Preacher Curl")]
    // The tail of a longer name, where the library holds that tail.
    [InlineData("Seated Machine Lat Pulldown", "Lat Pulldown")]
    // Exact spelling still matches, unchanged.
    [InlineData("Pull Up", "Pull Up")]
    public async Task A_written_name_finds_the_movement_it_spells(string written, string expected)
    {
        var (h, catalog) = await Library();
        await using var _h = h;

        var matched = await catalog.Match(written, default);

        Assert.NotNull(matched);
        Assert.Equal(await h.ExerciseId(Slug(expected)), matched);
    }

    [Theory]
    // A single trailing word is the family, not the movement: a front squat is not a squat.
    [InlineData("Front Squat")]
    [InlineData("Bulgarian Split Squat")]
    // Nothing in the library spells this at all, and an unlinked name is the honest answer.
    [InlineData("Copenhagen Plank")]
    public async Task A_name_the_library_does_not_hold_stays_unresolved(string written)
    {
        var (h, catalog) = await Library();
        await using var _h = h;

        Assert.Null(await catalog.Match(written, default));
    }

    private static string Slug(string name) => name switch
    {
        "Pull Up" => "pull-up",
        "Dumbbell Incline Press" => "incline-press",
        "Lat Pulldown" => "lat-pulldown",
        "Preacher Curl" => "preacher-curl",
        _ => "squat"
    };
}
