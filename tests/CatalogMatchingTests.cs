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
            new SeedExercise("squat", "Squat", "Legs", "Barbell", "Cue", null),
            new SeedExercise("cable-kickback", "Cable Triceps Kickback", "Triceps", "Cable", "Cue", null),
            new SeedExercise("close-grip-lat-pulldown", "Close-Grip Lat Pulldown", "Back", "Cable", "Cue", null),
            new SeedExercise("chest-supported-t-bar-row", "Chest-Supported T-Bar Row", "Back", "Barbell", "Cue", null),
            new SeedExercise("machine-chest-press", "Machine Chest Press", "Chest", "Machine", "Cue", null),
            new SeedExercise("standing-calf-raise", "Standing Calf Raise", "Calves", "Machine", "Cue", null),
            new SeedExercise("dumbbell-wrist-curl", "DB Wrist Curl", "Forearms", "Dumbbell", "Cue", null),
            new SeedExercise("dumbbell-wrist-extension", "DB Wrist Extension", "Forearms", "Dumbbell", "Cue", ["Dumbbell Wrist Extension"]),
            new SeedExercise("modified-zottman-curl", "Modified Zottman Curl", "Biceps", "Dumbbell", "Cue", null));
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

    [Theory]
    [InlineData("Cable Triceps Two Drop Sets Kickback (~25% per)", "Cable Triceps Kickback")]
    [InlineData("Close-Grip Lat Lengthened Partials Pulldown (Extend Set)", "Close-Grip Lat Pulldown")]
    [InlineData("Machine Chest Weighted Static Hold Press", "Machine Chest Press")]
    [InlineData("Pull-Up Lengthened Partials (Wide Grip) (Extend Set)", "Pull-Up")]
    [InlineData("Standing Calf Lengthened Partials Raise (Extend Set)", "Standing Calf Raise")]
    [InlineData("Chest-Supported Two Drop Sets T-Bar Row (~25% per)", "Chest-Supported T-Bar Row")]
    public async Task A_set_technique_does_not_hide_the_movement(string written, string expected)
    {
        var (h, catalog) = await Library();
        await using var _h = h;

        var matched = await catalog.Match(written, default);

        Assert.NotNull(matched);
        Assert.Equal(await h.ExerciseId(Slug(expected)), matched);
    }

    [Theory]
    [InlineData("DB Wrist Curl", "dumbbell-wrist-curl")]
    [InlineData("Dumbbell Wrist Extension", "dumbbell-wrist-extension")]
    [InlineData("Modified Zottman Curl", "modified-zottman-curl")]
    public async Task Newly_catalogued_pdf_movements_match_without_an_unsafe_neighbour(string written, string slug)
    {
        var (h, catalog) = await Library();
        await using var _h = h;

        Assert.Equal(await h.ExerciseId(slug), await catalog.Match(written, default));
    }

    [Fact]
    public async Task A_choice_label_stays_unresolved_instead_of_picking_a_squat_variant()
    {
        var (h, catalog) = await Library();
        await using var _h = h;

        Assert.Null(await catalog.Match("Squat (Your Choice)", default));
    }

    private static string Slug(string name) => name switch
    {
        "Pull Up" => "pull-up",
        "Dumbbell Incline Press" => "incline-press",
        "Lat Pulldown" => "lat-pulldown",
        "Preacher Curl" => "preacher-curl",
        "Cable Triceps Kickback" => "cable-kickback",
        "Close-Grip Lat Pulldown" => "close-grip-lat-pulldown",
        "Chest-Supported T-Bar Row" => "chest-supported-t-bar-row",
        "Machine Chest Press" => "machine-chest-press",
        "Pull-Up" => "pull-up",
        "Standing Calf Raise" => "standing-calf-raise",
        _ => "squat"
    };
}
