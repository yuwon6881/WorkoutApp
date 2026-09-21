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
        { "Eccentric-Overloaded Rope Overhead Triceps Extension", "Overhead Cable Triceps Extension (Rope)" }
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
