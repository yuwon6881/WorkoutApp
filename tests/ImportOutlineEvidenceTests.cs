using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportOutlineEvidenceTests
{
    private static ImportOutlineEvidence.Evidence Evidence() => ImportOutlineEvidence.Read([
        new ImportPageText(25, "BLOCK 1\nINTRO WEEK\nWEEK 1\nUpper 1"),
        new ImportPageText(26, "WEEK 2\nUpper 2"),
        new ImportPageText(55, "BLOCK 2\nDELOAD WEEK\nWEEK 7\nUpper 1"),
        new ImportPageText(56, "WEEK 8\nUpper 2")
    ]);

    [Fact]
    public void Overlapping_outline_ranges_coalesce_to_page_and_week_unions_without_adding_day_estimates()
    {
        var normalized = ImportOutlineEvidence.NormalizeChunks([
            new AiOutlineChunk("Weeks 1-6", "Block 1", "Base", 1, 6, 32, 42, 30),
            new AiOutlineChunk("Weeks 1-6 copy", "BLOCK 1", "Base", 1, 6, 33, 43, 28),
            new AiOutlineChunk("Nested pages", "Block 1", "Base", 2, 5, 34, 40, 18)
        ], Evidence());

        var chunk = Assert.Single(normalized);
        Assert.Equal((1, 6, 32, 43, 30), (chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount));
        Assert.Equal("Block 1", chunk.Block);
        Assert.Null(chunk.Phase);
    }

    [Fact]
    public void Alternative_routines_are_normalized_independently_even_when_they_share_pages()
    {
        var source = Evidence();
        var fullBody = ImportOutlineEvidence.NormalizeChunks([
            new AiOutlineChunk("Full Body", "Block 1", "Base", 1, 6, 32, 42, 28)
        ], source);
        var upperLower = ImportOutlineEvidence.NormalizeChunks([
            new AiOutlineChunk("Upper/Lower", "Block 1", "Base", 1, 6, 32, 42, 20)
        ], source);

        Assert.Equal("Full Body", Assert.Single(fullBody).Label);
        Assert.Equal("Upper/Lower", Assert.Single(upperLower).Label);
        Assert.Equal(28, fullBody[0].DayCount);
        Assert.Equal(20, upperLower[0].DayCount);
    }

    [Fact]
    public void Nonoverlapping_chunks_keep_their_ranges_and_explicit_source_structure()
    {
        var normalized = ImportOutlineEvidence.NormalizeChunks([
            new AiOutlineChunk("Intro", "Block 1", "Intro Week", 1, 1, 25, 30, 7),
            new AiOutlineChunk("Deload", "Block 2", "Deload Week", 7, 7, 55, 60, 7)
        ], Evidence());

        Assert.Equal(2, normalized.Count);
        Assert.Equal(("Block 1", "Intro Week", 25, 30, 7),
            (normalized[0].Block, normalized[0].Phase, normalized[0].PageFrom, normalized[0].PageTo, normalized[0].DayCount));
        Assert.Equal(("Block 2", "Deload Week", 55, 60, 7),
            (normalized[1].Block, normalized[1].Phase, normalized[1].PageFrom, normalized[1].PageTo, normalized[1].DayCount));
    }

    [Fact]
    public void Draft_structure_uses_unambiguous_source_headings_and_clears_invented_labels()
    {
        var evidence = Evidence();
        var draft = new ImportDraft("Min-Max", [
            Workout(1, "Upper 1", "Block 1", "Base", 25),
            Workout(7, "Upper 1", "Block 9", "Base", 55),
            Workout(8, "Upper 2", "Block 2", "Deload Week", 56)
        ]);

        var normalized = ImportOutlineEvidence.NormalizeDraft(draft, evidence);

        Assert.Equal([("Block 1", "Intro Week"), ("Block 2", "Deload Week"), ("Block 2", null)],
            normalized.Workouts.Select(workout => (workout.Block, workout.Phase)));
    }

    [Fact]
    public void Structural_headings_accept_subtitles_parentheses_and_fused_table_headers()
    {
        var evidence = ImportOutlineEvidence.Read([
            new ImportPageText(1, "BLOCK 1: 5-WEEK CLIMB PHASE\nWEEK 1 Exercise | Sets | Reps\nBarbell Row | 3 | 8"),
            new ImportPageText(2, "WEEK 7\n(BLOCK 2)\nExercise | Sets | Reps\nBarbell Row | 3 | 8")
        ]);

        Assert.Contains("Block 1", evidence.Blocks.Values);
        Assert.Contains("Block 2", evidence.Blocks.Values);
        var weekOne = Assert.Single(evidence.Pages[1], context => context.Week == 1);
        Assert.Equal("Block 1", weekOne.Block);
        var weekSeven = Assert.Single(evidence.Pages[2], context => context.Week == 7);
        Assert.Equal("Block 2", weekSeven.Block);
    }

    [Theory]
    [InlineData("BLOCK 1: 5-WEEK CLIMB PHASE")]
    [InlineData("(BLOCK 1)")]
    public void Outline_block_labels_are_resolved_through_source_heading_grammar(string modelBlock)
    {
        var normalized = ImportOutlineEvidence.NormalizeChunks([
            new AiOutlineChunk("Weeks 1-6", modelBlock, null, 1, 6, 25, 26, 12)
        ], Evidence());

        Assert.Equal("Block 1", Assert.Single(normalized).Block);
    }

    [Theory]
    [InlineData("WEEK 1-6 Exercise | Sets | Reps")]
    [InlineData("WEEK 1 & 2 Exercise | Sets | Reps")]
    public void Week_ranges_and_multiweek_banners_are_not_read_as_single_weeks(string banner)
    {
        var evidence = ImportOutlineEvidence.Read([new ImportPageText(1, $"{banner}\nExercise | Sets | Reps")]);

        Assert.DoesNotContain(evidence.Pages[1], context => context.Week is not null);
    }

    [Fact]
    public void Fused_week_prefix_is_context_but_day_labels_do_not_enter_phase_vocabulary()
    {
        var evidence = ImportOutlineEvidence.Read([
            new ImportPageText(1, "ACCUMULATION\nDAY LABEL: Deload Week\nWEEK 1 Exercise | Sets | Reps\nWEEK 2 Exercise | Sets | Reps")
        ]);

        Assert.Equal([1, 2], evidence.Pages[1].Where(context => context.Week.HasValue)
            .Select(context => context.Week!.Value));
        Assert.All(evidence.Pages[1].Where(context => context.Week.HasValue), context => Assert.Equal("Accumulation", context.Phase));
        Assert.DoesNotContain("Deload Week", evidence.Phases.Values);
    }

    [Fact]
    public void Fused_block_prefix_is_read_from_the_leading_table_cell()
    {
        var evidence = ImportOutlineEvidence.Read([
            new ImportPageText(1, "BLOCK 1 Exercise | Sets | Reps\nWEEK 1 Exercise | Sets | Reps\nBench Press | 3 | 8")
        ]);

        Assert.Contains("Block 1", evidence.Blocks.Values);
        Assert.Contains(evidence.Pages[1], context => context.Week == 1 && context.Block == "Block 1");
    }

    private static DraftWorkout Workout(int week, string name, string? block, string? phase, int page)
        => new(Guid.NewGuid(), week, name, null, null, [], block, phase, 1, SourcePage: page);
}
