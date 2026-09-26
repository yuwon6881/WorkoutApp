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
    [InlineData("N/A")]
    [InlineData("-")]
    [InlineData("NOTES")]
    [InlineData("")]
    public void A_reps_cell_that_states_nothing_leaves_the_target_empty(string printed)
    {
        var text = ImportNormalization.RepsText(printed);
        Assert.Null(text);
        Assert.Equal(((int?)null, (int?)null, false), ImportNormalization.Reps(0, 0, text));
    }

    [Fact]
    public void An_open_reps_cell_keeps_its_words_but_no_count()
    {
        Assert.Equal("AMRAP", ImportNormalization.RepsText("AMRAP"));
        Assert.Equal(((int?)null, (int?)null, false), ImportNormalization.Reps(1, 1, "AMRAP"));
        Assert.Equal(((int?)8, (int?)10, false), ImportNormalization.Reps(8, 10, "8-10"));
    }

    [Fact]
    public void A_set_with_no_rep_target_is_valid_but_a_half_empty_range_is_not()
    {
        Workout.Api.Domain.Validation.Prescriptions([new(null, null, 8, 90, null, null, null)]);
        var error = Assert.Throws<Workout.Api.Domain.DomainException>(() =>
            Workout.Api.Domain.Validation.Prescriptions([new(8, null, 8, 90, null, null, null)]));
        Assert.Equal("Give both rep bounds or leave both empty.", error.Message);
    }

    [Fact]
    public void A_set_with_no_rep_target_is_never_prefilled_with_a_count()
    {
        var prescription = new Workout.Api.Domain.SetPrescription(null, null, 8, 90, null, null, null);
        var (min, max) = Workout.Api.Domain.Progression.LoadRuleReps(prescription);
        var suggestion = Workout.Api.Domain.Progression.SuggestSet(min, max, 8, [], "normal", 2.5);

        Assert.Null(Workout.Api.Domain.Progression.PrefillReps(prescription, suggestion));
        Assert.Equal("No rep target is set: log the reps you do.",
            Workout.Api.Domain.Progression.ForPrescription(prescription, suggestion).Reason);
    }

    private static DraftWorkout Day(int week, string name, int page, bool rest = false)
        => new(Guid.NewGuid(), week, name, null, null, rest ? [] : [Exercise(name, page)], null, null, week, rest, page);

    private static List<ImportPageText> VersionPages() =>
    [
        new(64, "WHAT WEEK TO RUN?\n• RUN WEEK 10A ONLY IF YOU HAVE COMPETITIVE POWERLIFTING GOALS\n• RUN WEEK 10B IF YOU HAVE MOSTLY BODYBUILDING AND GENERAL STRENGTH GOALS"),
        new(63, "WEEK 9\nDAY LABEL: FULL BODY 1"),
        new(66, "WEEK 10A\nMAX TESTING OPTION A: CHOOSE EITHER WEEK 10A OR WEEK 10B. DO NOT RUN BOTH WEEKS.\nDAY LABEL: SQUAT TEST"),
        new(68, "WEEK 10B\nMAX TESTING OPTION B: CHOOSE EITHER WEEK 10A OR WEEK 10B. DO NOT RUN BOTH WEEKS.\nDAY LABEL: SQUAT TEST"),
        new(70, "WEEK 11\nDAY LABEL: FULL BODY 1")
    ];

    /// The versions read as consecutive weeks, the way both are kept before a choice is made.
    private static ImportDraft VersionDraft() => new("Powerbuilding",
    [
        Day(9, "Full Body 1", 63), Day(9, "Rest", 63, rest: true),
        Day(10, "Squat Test", 66), Day(10, "Rest", 66, rest: true),
        Day(11, "Squat Test", 68), Day(11, "Rest", 68, rest: true),
        Day(12, "Full Body 1", 70)
    ]);

    [Fact]
    public void A_week_printed_in_versions_is_offered_as_a_choice_with_the_documents_advice()
    {
        var choices = ImportWeekChoice.Offer(VersionDraft(), VersionPages());

        Assert.Equal(["week-a", "week-b"], choices.Select(choice => choice.Id));
        Assert.Equal(["Week 10A", "Week 10B"], choices.Select(choice => choice.Name));
        Assert.All(choices, choice => Assert.Equal(ImportAlternativeKinds.Week, choice.Kind));
        Assert.Equal("Run week 10A only if you have competitive powerlifting goals", choices[0].Description);
        Assert.Equal(3, choices[0].WeekCount);
        Assert.Equal(2, choices[0].DayLineIds!.Count);
    }

    [Fact]
    public void Choosing_a_week_version_keeps_only_its_days_in_the_week_the_document_numbers()
    {
        var draft = VersionDraft();
        var choices = ImportWeekChoice.Offer(draft, VersionPages());

        var chosen = ImportWeekChoice.Apply(draft, choices[1], choices);

        Assert.Equal([9, 9, 10, 10, 11], chosen.Workouts.Select(day => day.Week));
        Assert.Equal(68, chosen.Workouts.Single(day => day.Week == 10 && !day.IsRestDay).SourcePage);
        Assert.Equal(11, chosen.Workouts[^1].PhaseWeek);
    }

    [Fact]
    public void A_program_without_lettered_weeks_offers_no_choice()
        => Assert.Empty(ImportWeekChoice.Offer(VersionDraft(), [new(63, "WEEK 9"), new(66, "WEEK 10")]));

    /// Min-Max's introduction says "Block 2 introduces:" before the schedule prints "BLOCK 1". Read
    /// as a banner, that marked block 2 as already left, so its real banner was ignored.
    [Fact]
    public void An_introduction_that_names_a_later_block_does_not_hide_that_blocks_banner()
    {
        var pages = new List<ImportPageText> { new(1, "Block 1 includes no intensity techniques.\nBlock 2 introduces:") };
        for (var week = 1; week <= 4; week++)
            pages.Add(new(week + 1, $"{(week == 1 ? "BLOCK 1\n" : week == 3 ? "Block 2\n" : "")}DAY LABEL: Full Body\n" +
                "Exercise | Warm-up Sets | Working Sets | Reps | Rest\n" + $"WEEK {week}\nSquat | 1 | 2 | 6-8 | 2 min"));

        var schedule = ImportPrintedSchedule.Read(pages)!;

        Assert.Equal(["Block 1", "Block 1", "Block 2", "Block 2"], schedule.Days.Select(day => day.Block));
    }

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
