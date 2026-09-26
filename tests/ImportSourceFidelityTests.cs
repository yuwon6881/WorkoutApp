using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Defects found by checking every sample program's import against its printed pages. Each rule is
/// written for the layout, never for the program it was found in.
public sealed class ImportSourceFidelityTests
{
    private static DraftSet Set(int min, int max, string? repsText = null, string? load = null, int? page = 1)
        => new(min, max, 9, 120, null, load, null, RepsText: repsText, Rir: "1", SourcePage: page);

    private static DraftExercise Exercise(string name, int page, params string[] substitutions)
        => new(Guid.NewGuid(), name, null, null, [Set(8, 10, page: page)], Substitutions: [.. substitutions], SourcePage: page);

    [Theory]
    [InlineData("SUGGESTED REST DAY (1-2 DAYS OFF DEPENDING ON YOUR SCHEDULE)")]
    [InlineData("MANDATORY REST DAY")]
    [InlineData("2 REST DAYS")]
    public void A_rest_band_may_carry_a_short_parenthetical(string band)
        => Assert.Matches(ImportLongWeeks.RestBand, band);

    [Fact]
    public void Rest_band_does_not_swallow_a_sentence_about_rest()
        => Assert.DoesNotMatch(ImportLongWeeks.RestBand, "REST DAY PROTOCOL: walk for 30 minutes and stretch");

    [Fact]
    public void A_channel_page_is_not_a_demonstration_and_the_share_token_is_dropped()
    {
        Assert.Null(ImportDemoLinks.Video("http://youtube.com/jeffnippard"));
        Assert.Null(ImportDemoLinks.Video("https://www.youtube.com/"));
        Assert.Equal("https://youtu.be/ijsSiWSzYw0", ImportDemoLinks.Video("https://youtu.be/ijsSiWSzYw0?si=hClxWcLkjz1SkZUG"));
        Assert.Equal("https://youtu.be/qVek72z3F1U?t=683", ImportDemoLinks.Video("https://youtu.be/qVek72z3F1U?t=683&si=a"));
    }

    [Fact]
    public void One_video_shared_with_different_tokens_still_reaches_a_repeated_week()
    {
        // Two blocks print the same video with a different share token, and the later week's
        // page is not known when the link is attached, so only the document-wide name can match.
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 2, "Pull #1", null, null, [Exercise("Chest-Supported Machine Row", 0) with { SourcePage = null }])
        ]);
        var attached = ImportDemoLinks.Attach(draft, ImportDemoLinks.Normalize([
            new ImportPageLink(6, "Chest-Supported Machine Row", "https://youtu.be/ijsSiWSzYw0?si=first"),
            new ImportPageLink(50, "Chest-Supported Machine Row", "https://youtu.be/ijsSiWSzYw0?si=second")
        ], 80));

        Assert.Equal("https://youtu.be/ijsSiWSzYw0", attached.Workouts[0].Exercises[0].DemoUrl);
    }

    [Fact]
    public void A_printed_copy_cut_short_by_a_wrap_does_not_cancel_the_annotation()
    {
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 1, "Lower", null, null, [Exercise("Lying Leg Curl", 40)], SourcePage: 40)
        ]);
        var attached = ImportDemoLinks.Attach(draft, [
            new ImportPageLink(94, "LYING LEG CURL", "https://www.youtube.com/watch?v=e_48W0vlU58&feature=youtu.be"),
            new ImportPageLink(94, "LYING LEG CURL", "https://www.youtube.com/watch?v=e_48W0vlU58&feature=youtu")
        ]);

        Assert.Equal("https://www.youtube.com/watch?v=e_48W0vlU58&feature=youtu.be", attached.Workouts[0].Exercises[0].DemoUrl);
    }

    [Fact]
    public void Two_different_videos_for_one_name_still_attach_neither()
    {
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 1, "Lower", null, null, [Exercise("Lying Leg Curl", 40)], SourcePage: 40)
        ]);
        var attached = ImportDemoLinks.Attach(draft, [
            new ImportPageLink(94, "LYING LEG CURL", "https://youtu.be/e_48W0vlU58"),
            new ImportPageLink(95, "LYING LEG CURL", "https://youtu.be/otherVideo1")
        ]);

        Assert.Null(attached.Workouts[0].Exercises[0].DemoUrl);
    }

    [Fact]
    public void A_day_title_fused_into_the_link_text_is_taken_out_on_its_own_page()
    {
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 1, "Pull #1 (Lat Focused)", null, null, [Exercise("Hammer Preacher Curl", 6)], SourcePage: 6),
            new DraftWorkout(Guid.NewGuid(), 1, "Lower #2", null, null, [Exercise("Weighted 45° Hyperextension", 9)], SourcePage: 9)
        ]);
        var attached = ImportDemoLinks.Attach(draft, [
            new ImportPageLink(6, "Hammer Preacher Pull #1 (Lat Focused) Curl", "https://youtu.be/dEdnC3ca"),
            new ImportPageLink(9, "Weighted 45° Lower #2 Hyperextension", "https://youtu.be/hyper123"),
            // The same fused text on a page that prints another day is not evidence for this one.
            new ImportPageLink(7, "Hammer Preacher Pull #1 (Lat Focused) Curl", "https://youtu.be/elsewhere")
        ]);

        Assert.Equal("https://youtu.be/dEdnC3ca", attached.Workouts[0].Exercises[0].DemoUrl);
        Assert.Equal("https://youtu.be/hyper123", attached.Workouts[1].Exercises[0].DemoUrl);
    }

    [Fact]
    public void A_role_tag_on_the_row_does_not_hide_the_glossary_demonstration()
    {
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 5, "Full Body 1", null, null, [Exercise("[TOPSET] BACK SQUAT", 40)], SourcePage: 40)
        ]);
        var attached = ImportDemoLinks.Attach(draft, [new ImportPageLink(100, "BACK SQUAT", "https://youtu.be/squat01")]);

        Assert.Equal("https://youtu.be/squat01", attached.Workouts[0].Exercises[0].DemoUrl);
    }

    [Fact]
    public void An_alternative_in_the_library_spelling_keeps_its_printed_link()
    {
        var draft = new ImportDraft("Program", [
            new DraftWorkout(Guid.NewGuid(), 1, "Upper", null, null,
                [Exercise("Incline DB Press", 12, "Incline Smith Machine Press")], SourcePage: 12)
        ]);
        var attached = ImportDemoLinks.Attach(draft, [new ImportPageLink(12, "Smith Machine Incline Press", "https://youtu.be/smith01")]);

        Assert.Equal("https://youtu.be/smith01", attached.Workouts[0].Exercises[0].DemoLinks!["incline smith machine press"]);
    }

    [Fact]
    public void Whole_name_matching_never_takes_a_name_the_written_one_merely_ends_with()
    {
        var library = new Dictionary<string, Guid> { [CatalogService.Normalize("Machine Shoulder Press")] = Guid.NewGuid() };

        Assert.NotNull(CatalogMatching.Find(library, "Seated Smith Machine Shoulder Press"));
        Assert.Null(CatalogMatching.FindWhole(library, "Seated Smith Machine Shoulder Press"));
        Assert.NotNull(CatalogMatching.FindWhole(library, "machine shoulder press"));
    }

    [Fact]
    public void A_reverse_pyramid_gives_each_working_set_its_own_reps()
    {
        var working = Enumerable.Repeat(Set(4, 4, "4, 6, 8"), 3).ToList();

        var sets = ImportSetKinds.PerSetReps(working);

        Assert.Equal([4, 6, 8], sets.Select(set => set.RepMin));
        Assert.Equal([4, 6, 8], sets.Select(set => set.RepMax));
        Assert.All(sets, set => Assert.Equal("extracted", set.RepsSource));
    }

    [Fact]
    public void A_rep_list_that_does_not_fit_the_set_count_stays_as_printed()
    {
        // "5, 15" is one set of 5 then 15 reps, printed against a single working set.
        List<DraftSet> single = [Set(5, 5, "5, 15")];
        Assert.Equal(single, ImportSetKinds.PerSetReps(single));
        var three = Enumerable.Repeat(Set(8, 8, "8, 5"), 3).ToList();
        Assert.Equal(three, ImportSetKinds.PerSetReps(three));
    }

    [Theory]
    [InlineData("AMRAP", null)]
    [InlineData("12-15 (dropset)", "12-15")]
    [InlineData("3-5", "3-5")]
    public void A_modelled_warmup_keeps_only_the_plain_rep_count(string workingReps, string? warmupReps)
    {
        var sets = ImportSetKinds.Compose([Set(3, 5, workingReps, load: "87.5%")], 2, "Back Squat");

        Assert.Equal(3, sets.Count);
        Assert.All(sets.Take(2), warmup =>
        {
            Assert.True(warmup.Warmup);
            Assert.Null(warmup.LoadText);
            Assert.Null(warmup.TargetRpe);
            Assert.Equal(warmupReps, warmup.RepsText);
        });
        Assert.Equal("87.5%", sets[2].LoadText);
    }

    [Fact]
    public void A_general_warmup_table_before_the_first_week_is_not_a_day()
    {
        var pages = new List<ImportPageText>
        {
            new(33, "THE GENERAL WARMUP\nEXERCISE | SETS | REPS/TIME | NOTES\nLow Intensity Cardio | N/a | 5-10min | Pick any machine"),
            new(36, "WEEK 1\nFULL BODY 1\nBACK SQUAT | 4 | 1 | 5"),
            new(60, "THE GENERAL WARMUP\nWEEK 9 reminder: warm up as usual")
        };
        var routine = new DraftWorkout(Guid.NewGuid(), 1, "Week 1 day 1", null, null, [Exercise("Low Intensity Cardio", 33)], SourcePage: 33);
        var training = new DraftWorkout(Guid.NewGuid(), 1, "Full Body 1", null, null, [Exercise("Back Squat", 36)], SourcePage: 36);

        var result = ImportWarmupRoutine.LeaveOut([routine, training], pages);

        Assert.Equal([training.LineId], result.Workouts.Select(day => day.LineId));
        Assert.Equal("warmup_routine_left_out", Assert.Single(result.Notices).Code);
    }

    [Fact]
    public void A_warmup_titled_day_after_the_program_starts_is_kept()
    {
        var pages = new List<ImportPageText>
        {
            new(36, "WEEK 1\nFULL BODY 1\nBACK SQUAT | 4 | 1 | 5"),
            new(40, "DYNAMIC WARM-UP\nEXERCISE | SETS | REPS\nLeg Swing | 2 | 12")
        };
        var training = new DraftWorkout(Guid.NewGuid(), 1, "Full Body 1", null, null, [Exercise("Back Squat", 36)], SourcePage: 36);
        var later = new DraftWorkout(Guid.NewGuid(), 1, "Mobility", null, null, [Exercise("Leg Swing", 40)], SourcePage: 40);

        var result = ImportWarmupRoutine.LeaveOut([training, later], pages);

        Assert.Equal(2, result.Workouts.Count);
        Assert.Empty(result.Notices);
    }
}
