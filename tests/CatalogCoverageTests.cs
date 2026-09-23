using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The shipped catalog was curated against one program, so a second document's spellings fell
/// through to the manual mapping queue in bulk. These are the movements Jeff Nippard's
/// Upper/Lower writes: they are checked against `deploy/exercises.json` itself, because a
/// synthetic library would prove nothing about what a real import resolves.
public sealed class CatalogCoverageTests
{
    /// Written name → the catalog entry it must reach. Some were absent and are now seeded;
    /// the rest already existed under another spelling and needed an alias.
    public static TheoryData<string, string> WrittenNames => new()
    {
        { "Deficit Deadlift", "Deficit Deadlift" },
        { "Leg Curl", "Leg Curl" },
        { "Dumbbell Row", "Dumbbell Row" },
        { "Barbell Supinated Row", "Barbell Supinated Row" },
        { "Cable Upright Row", "Cable Upright Row" },
        { "Barbell Floor Press", "Barbell Floor Press" },
        { "California Press", "California Press" },
        { "Band Pull-Apart", "Band Pull-Apart" },
        { "Reverse Hyper", "Reverse Hyper" },
        { "Plank", "Plank" },
        { "Bulgarian Split Squat", "DB Bulgarian Split Squat" },
        { "Military Press", "Overhead Press" },
        { "Single-Arm Pulldown", "1-Arm Cable Pulldown" },
        { "Cable Standing Hip Abduction", "Cable Hip Abduction" },
        { "Eccentric-Accentuated Cable Row", "Seated Cable Row" },
        { "Eccentric-Overloaded Rope Overhead Triceps Extension", "Overhead Cable Triceps Extension (Rope)" },
        { "Squat", "Back Squat" },
        { "Standing Dumbbell Arnold Press", "Standing DB Arnold Press" },
        { "1-Arm DB Preacher Curl", "DB Preacher Curl" },
        { "Close-Grip Seated Cable Row", "Cable Close-Grip Row" },
        { "High-Incline Smith Machine Press", "Incline Smith Machine Press" },
        { "Dumbbell RDL", "DB Romanian Deadlift" },
        { "Hammer Cheat Curl", "Hammer Curl" },
        { "Reverse Pec Deck", "Reverse Pec Deck" },
        { "Egyptian Cable Lateral Raise", "Egyptian Cable Lateral Raise" },
        { "Diamond Push Up", "Diamond Push Up" },
        { "Med-Ball Close Grip Push Up", "Med-Ball Close Grip Push Up" },
        { "Corpse Crunch", "Corpse Crunch" },
        { "LLPT Plank", "LLPT Plank" },
        { "Roman Chair Leg Raise", "Roman Chair Leg Raise" },
        { "Plate Front Raise", "Plate Front Raise" },
        { "Machine Low Row", "Machine Low Row" },
        { "Wide-Grip Cable Row", "Wide-Grip Cable Row" },
        { "Omni-Grip Lat Pulldown", "Omni-Grip Lat Pulldown" },
        { "N1-Style Cross-Body Cable Bicep Curl", "N1-Style Cross-Body Cable Bicep Curl" },
        { "N1-Style Cross-Body Triceps Extension", "N1-Style Cross-Body Triceps Extension" },
        { "Pec Static Stretch", "Pec Static Stretch" },
        { "Lat Static Stretch", "Lat Static Stretch" },
        { "Side Delt Static Stretch", "Side Delt Static Stretch" },
        { "Bicep Static Stretch", "Bicep Static Stretch" },
        // The Essentials Program: each of these is printed verbatim in that PDF.
        { "Spider Curl", "Spider Curl" },
        { "Cable Shoulder Press", "Cable Shoulder Press" },
        { "Machine Squat (Heavy)", "Machine Squat" },
        { "Machine Squat (Back off)", "Machine Squat" },
        { "Two-Arms Two-Legs Dead Bug", "Dead Bug" },
        { "Inverse Zottman Curl", "Zottman Curl" },
        // Written "Pullup" where the catalog spells it "Pull-up".
        { "2-Grip Pullup", "2-Grip Pull-up" },
        // Powerbuilding 3.0 (4x/week), as its tables print them.
        { "Back Squat (Top Single)", "Back Squat" },
        { "Pin Good Morning (or 45° Back Extension)", "Good Morning" },
        { "Barbell (or EZ-Bar) Strict Curl", "EZ-Bar Strict Curl" },
        { "Seated Face Pull", "Rope Face Pull" },
        { "Anderson Squat", "Anderson Squat" },
        { "Close Grip Bench Press", "Close-Grip Bench Press" },
        { "Dumbbell Skull Crusher", "DB Skull Crusher" },
        { "Dumbbell Lateral Raise", "DB Lateral Raise" },
        { "Cable Pullover", "Cable Lat Pullover" },
        { "Helms Row", "Helms DB Row" },
        { "Hip Abduction", "Machine Hip Abduction" },
        { "Barbell Box Squat", "Barbell Box Squat" },
        { "Touch-And-Go Deadlift", "Touch-and-Go Deadlift" },
        { "Reset Deadlift", "Reset Deadlift" },
        // Powerbuilding 2.0 and the Powerbuilding System.
        { "Chin-Up", "Chin-Up" },
        { "6\" Block Pull", "Block Pull" },
        { "Pin Squat", "Pin Squat" },
        { "Face Pull", "Rope Face Pull" },
        { "Concentration Bicep Curl", "DB Concentration Curl" },
        { "Egyptian Lateral Raise", "Egyptian Cable Lateral Raise" },
        // The Pure Bodybuilding Program (Upper/Lower, Phase 2) and the Transformation System.
        { "Machine Hip Adduction", "Machine Hip Adduction" },
        { "Straight-Bar Lat Prayer", "Cable Lat Prayer" },
        { "Assisted Pull-Up", "Assisted Pull-Up" },
        { "Paused Assisted Dip", "Assisted Dip" },
        { "Bottom-2/3 Constant Tension Preacher Curl", "EZ-Bar Preacher Curl" },
        { "Dual-Cable Triceps Press", "Dual-Cable Triceps Press" },
        { "Triceps Diverging Pressdown (Long Rope or 2 Ropes)", "Triceps Diverging Pressdown" },
        { "DB Calf Jumps", "DB Calf Jumps" },
        { "Smith Machine Reverse Lunge", "Smith Machine Reverse Lunge" },
        { "Rear Delt 45° Cable Flye", "Rear Delt 45° Cable Flye" },
        { "1-Arm 45° Cable Rear Delt Flye", "Rear Delt 45° Cable Flye" },
        { "Chest-Supported T-Bar Row + Kelso Shrug", "Chest-Supported T-Bar Row" },
        { "Katana Triceps Extension", "Katana Triceps Extension" },
        { "Smith Machine Deficit Row", "Smith Machine Deficit Row" },
        { "Ab Wheel Rollout", "Ab Wheel Rollout" },
        { "Glute Kickback", "Glute Kickback" },
        { "EZ-Bar Cheat Curl", "EZ-Bar Curl" },
        // Fundamentals, the Intermediate/Advanced PPL and Upper/Lower 6x, which spell out what
        // the catalog abbreviates and write "Tricep" where it writes "Triceps".
        { "DUMBBELL PREACHER CURL", "DB Preacher Curl" },
        { "CABLE TRICEP KICKBACK", "Cable Triceps Kickback" },
        { "DUMBBELL SUPINATED CURL", "Supinated Dumbbell Curl" },
        { "DUMBBELL SEATED SHOULDER PRESS", "Seated DB Shoulder Press" },
        { "ASSISTED DIP", "Assisted Dip" },
        { "CRUNCH", "Crunch" },
        { "SEAL ROW", "Seal Row" },
        { "MACHINE HIGH ROW", "Machine High Row" },
        // Shoulder Hypertrophy: distinct printed movements are seeded; faithful equipment and
        // handle spellings resolve to the existing movement.
        { "Cable External Rotation", "Cable External Rotation" },
        { "Standing Overhead Barbell Press", "Barbell Overhead Press" },
        { "Standing Overhead Barbell Press (Warm Up)", "Barbell Overhead Press" },
        { "Incline Dumbbell Lateral Hold", "Incline Dumbbell Lateral Hold" },
        { "Banded Lateral Raise", "Banded Lateral Raise" },
        { "Bent Over Dumbbell Reverse Flye", "Bent Over Dumbbell Reverse Flye" },
        { "Standing Dumbbell Press", "Standing Dumbbell Press" },
        { "Banded Front Y Raise", "Banded Front Y Raise" },
        { "Rope Facepull", "Rope Face Pull" },
        { "Rope Upright Row", "Cable Upright Row" },
        { "Wide Grip Seated Cable Row", "Wide-Grip Cable Row" },
        { "1-Arm DB Upright Row", "1-Arm Dumbbell Upright Row" },
        { "Reverse Cable Crossover (High)", "Reverse Cable Crossover" },
        { "Reverse Cable Crossover (Mid)", "Reverse Cable Crossover" }
    };

    [Theory, MemberData(nameof(WrittenNames))]
    public async Task A_written_name_reaches_the_movement_the_shipped_catalog_holds(string written, string expected)
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(SeedRows());
        var library = await harness.Catalog.MatchIndex(default);

        var id = CatalogMatching.Find(library, written);

        Assert.NotNull(id);
        Assert.Equal(expected, await harness.Catalog.NameFor(id!.Value, default));
    }

    /// A placeholder must keep reaching the reviewer rather than being answered by the catalog.
    [Theory]
    [InlineData("UPPER BODY WEAK POINT 1")]
    [InlineData("Squat (Your Choice)")]
    [InlineData("Weak Point Exercise 2 (optional)")]
    public async Task A_placeholder_still_stays_unresolved(string written)
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        await harness.Seed(SeedRows());
        var library = await harness.Catalog.MatchIndex(default);

        Assert.Null(CatalogMatching.Find(library, written));
    }

    /// An alias may only ever be claimed by one exercise, so a collision silently drops the
    /// second claim rather than failing the seed. Catch it here instead.
    [Fact]
    public void Every_seeded_name_and_alias_is_unique()
    {
        var rows = SeedRows();
        // An alias that restates its own entry's name is harmless; two entries claiming one key
        // is not, because the seed awards it to whichever row the file lists first.
        var keys = rows.SelectMany(row => (row.Aliases ?? []).Concat([row.Name])
            .Select(key => (Key: CatalogService.Normalize(key), row.Slug))).ToList();

        Assert.Empty(keys.GroupBy(entry => entry.Key, StringComparer.Ordinal)
            .Where(group => group.Select(entry => entry.Slug).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1)
            .Select(group => group.Key));
        Assert.Empty(rows.GroupBy(row => row.Slug, StringComparer.OrdinalIgnoreCase).Where(group => group.Count() > 1).Select(group => group.Key));
    }

    private static SeedExercise[] SeedRows()
        => [.. Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()))];

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
