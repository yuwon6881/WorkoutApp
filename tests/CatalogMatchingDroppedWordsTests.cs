using Xunit;
using Workout.Api.Services;

namespace Workout.Tests;

/// A link that settles for less than the written name is useful but uncertain, so the matcher says
/// which words it set aside and the external import flags the exercise for review.
public sealed class CatalogMatchingDroppedWordsTests
{
    private static readonly Guid Incline = Guid.NewGuid();
    private static readonly Guid Row = Guid.NewGuid();
    private static readonly Guid PullUp = Guid.NewGuid();

    private static Dictionary<string, Guid> Library()
    {
        var library = new Dictionary<string, Guid>(StringComparer.Ordinal);
        foreach (var (name, id) in new[] { ("Incline Press", Incline), ("Cable Row", Row), ("Pull Up", PullUp) })
        {
            var normalized = CatalogService.Normalize(name);
            library[normalized] = id;
            foreach (var key in CatalogMatching.LibraryKeys(normalized)) library.TryAdd(key, id);
        }
        return library;
    }

    [Fact]
    public void A_whole_name_drops_nothing()
        => Assert.Null(CatalogMatching.FindWithDropped(Library(), "Incline Press")!.Dropped);

    [Fact]
    public void A_shorter_tail_names_the_leading_words_it_set_aside()
    {
        var link = CatalogMatching.FindWithDropped(Library(), "Smith Machine Incline Press")!;
        Assert.Equal(Incline, link.Id);
        Assert.Equal("smith machine", link.Dropped);
    }

    [Fact]
    public void A_bracketed_equipment_qualifier_that_is_set_aside_is_reported()
    {
        var link = CatalogMatching.FindWithDropped(Library(), "Cable Row (Neutral Handle Attachment)")!;
        Assert.Equal(Row, link.Id);
        Assert.Equal("neutral handle attachment", link.Dropped);
    }

    [Fact]
    public void A_discarded_grip_qualifier_is_reported_unless_the_library_name_carries_it()
    {
        Assert.Equal("wide grip", CatalogMatching.FindWithDropped(Library(), "Pull-Up (Wide Grip)")!.Dropped);
        var wide = Guid.NewGuid();
        var library = Library();
        var wideName = CatalogService.Normalize("Wide Grip Pull Up");
        foreach (var key in CatalogMatching.LibraryKeys(wideName).Append(wideName)) library[key] = wide;
        var link = CatalogMatching.FindWithDropped(library, "Pull-Up (Wide Grip)")!;
        Assert.Equal(wide, link.Id);
        Assert.Null(link.Dropped);
    }

    [Fact]
    public void A_bracketed_set_method_is_not_a_dropped_qualifier()
        => Assert.Null(CatalogMatching.FindWithDropped(Library(), "Pull-Up (Tempo 3-1-1, 2 per side)")!.Dropped);

    [Fact]
    public void An_ambiguous_derived_key_ends_the_search_instead_of_falling_to_a_shorter_name()
    {
        var generic = Guid.NewGuid();
        var library = new Dictionary<string, Guid>(StringComparer.Ordinal)
        {
            ["dumbbell row"] = generic,
            ["~dumbbell row seated"] = CatalogMatching.Ambiguous
        };
        Assert.Null(CatalogMatching.FindWithDropped(library, "Seated Dumbbell Row"));
        Assert.Null(CatalogMatching.Find(library, "Seated Dumbbell Row"));
        Assert.Equal(generic, CatalogMatching.Find(library, "Dumbbell Row"));
    }

    [Fact]
    public async Task The_catalog_index_keeps_a_shared_derived_key_ambiguous()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("a", "Seated Dumbbell Row", "Back", "Dumbbell", null),
            new SeedExercise("b", "Dumbbell Seated Row", "Back", "Dumbbell", null),
            new SeedExercise("c", "Dumbbell Row", "Back", "Dumbbell", null));
        Assert.Null(await h.Catalog.Match("Row Seated Dumbbell", default));
        Assert.Equal(await h.ExerciseId("c"), await h.Catalog.Match("Dumbbell Row", default));
    }

    [Fact]
    public async Task An_expansion_does_not_settle_on_one_of_two_entries_that_claim_the_same_words()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("db-row", "DB Row", "Back", "Dumbbell", null),
            new SeedExercise("dumbbell-row", "Dumbbell Row", "Back", "Dumbbell", null));
        Assert.Equal(await h.ExerciseId("db-row"), await h.Catalog.Match("DB Row", default));
        Assert.Equal(await h.ExerciseId("dumbbell-row"), await h.Catalog.Match("Dumbbell Row", default));
        Assert.Null(await h.Catalog.Match("DBs Row", default));
        Assert.Null(await h.Catalog.Match("Row DB", default));
    }

    [Fact]
    public async Task A_trailing_machine_that_is_set_aside_is_flagged_and_never_offered_as_an_option()
    {
        Assert.Equal("machine", CatalogMatching.FindWithDropped(WithSeatedRow(), "Seated Row Machine")!.Dropped);
        var uncertainty = new ImportUncertainty(true, "Which?", [new ImportOption("Machine", "Seated Row Machine")]);
        Assert.Null(ExternalImportOptions.ForExercise(uncertainty, WithSeatedRow(), Row)!.Options);

        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("seated-row", "Seated Row", "Back", "Cable", null));
        var view = await h.Imports().CreateExternalImport(
            "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + "{\"sourceName\":\"Seated Row Machine\",\"sets\":[{\"repMin\":8,\"repMax\":10}]}]}]}}", "p.json", default);
        var exercise = view.Draft!.Workouts[0].Exercises[0];
        Assert.Equal(await h.ExerciseId("seated-row"), exercise.ExerciseId);
        Assert.Contains("machine", exercise.Uncertainty!.Reason);
    }

    private static Dictionary<string, Guid> WithSeatedRow()
    {
        var library = Library();
        var name = CatalogService.Normalize("Seated Row");
        library[name] = Guid.NewGuid();
        return library;
    }

    [Fact]
    public void An_offered_option_must_spell_the_movement_with_nothing_set_aside()
    {
        var library = Library();
        var wide = Guid.NewGuid();
        var uncertainty = new ImportUncertainty(true, "Which grip?", [
            new ImportOption("Wide", "Pull-Up (Wide Grip)"),
            new ImportOption("Smith", "Smith Machine Incline Press"),
            new ImportOption("Plain", "Pull Up")]);
        var kept = ExternalImportOptions.ForExercise(uncertainty, library, Row)!.Options!;
        Assert.Equal(["Plain"], kept.Select(option => option.Label));

        var wideName = CatalogService.Normalize("Wide Grip Pull Up");
        foreach (var key in CatalogMatching.LibraryKeys(wideName).Append(wideName)) library[key] = wide;
        kept = ExternalImportOptions.ForExercise(uncertainty, library, Row)!.Options!;
        Assert.Equal(["Wide", "Plain"], kept.Select(option => option.Label));
    }

    [Fact]
    public void A_bracketed_qualifier_the_library_name_carries_is_not_dropped()
    {
        var library = Library();
        var id = Guid.NewGuid();
        library["cable row dumbbell"] = id;
        Assert.Null(CatalogMatching.FindWithDropped(library, "Cable Row (Dumbbell)")!.Dropped);
    }

    [Fact]
    public async Task An_import_flags_a_link_that_set_words_aside_and_leaves_a_whole_name_unflagged()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("incline", "Incline Press", "Chest", "Machine", null),
            new SeedExercise("bench", "Bench Press", "Chest", "Barbell", null));
        static string Day(params string[] names) => "{\"version\":1,\"program\":{\"name\":\"P\",\"days\":[{\"key\":\"a\",\"week\":1,\"name\":\"A\",\"exercises\":["
            + string.Join(",", names.Select(name => $"{{\"sourceName\":\"{name}\",\"sets\":[{{\"repMin\":8,\"repMax\":10}}]}}"))
            + "]}]}}";

        var view = await h.Imports().CreateExternalImport(Day("Smith Machine Incline Press", "Bench Press"), "p.json", default);

        var exercises = view.Draft!.Workouts[0].Exercises;
        Assert.Equal(await h.ExerciseId("incline"), exercises[0].ExerciseId);
        Assert.True(exercises[0].Uncertainty!.Flag);
        Assert.Contains("smith machine", exercises[0].Uncertainty!.Reason);
        Assert.Null(exercises[1].Uncertainty);
        Assert.Contains(view.ReviewIssues!, issue => issue.Code == "external_uncertainty" && issue.ExerciseLineId == exercises[0].LineId);
        Assert.DoesNotContain(view.ReviewIssues!, issue => issue.Code == "external_uncertainty" && issue.ExerciseLineId == exercises[1].LineId);
    }

    [Fact]
    public void A_name_nothing_matches_has_no_link()
        => Assert.Null(CatalogMatching.FindWithDropped(Library(), "Zercher Carry"));

    [Fact]
    public void Dropped_words_flag_an_exercise_unless_the_file_already_flagged_it()
    {
        var id = Guid.NewGuid();
        var flagged = ExternalImportOptions.FlagDroppedWords(null, "smith machine", id)!;
        Assert.True(flagged.Flag);
        Assert.Contains("smith machine", flagged.Reason);
        var own = new ImportUncertainty(true, "Name cut off");
        Assert.Same(own, ExternalImportOptions.FlagDroppedWords(own, "smith machine", id));
        Assert.Null(ExternalImportOptions.FlagDroppedWords(null, null, id));
        Assert.Null(ExternalImportOptions.FlagDroppedWords(null, "smith machine", null));
    }
}
