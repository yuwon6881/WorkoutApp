using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportAbsoluteWeekTests
{
    [Fact]
    public void Sequential_phases_restarting_local_weeks_become_contiguous_absolute_weeks()
    {
        var chunks = new List<ImportChunk>
        {
            new("Phase 1: Foundation", null, "Phase 1", 1, 6, 35, 70, 36),
            new("Phase 2: Maximum Effort", null, "Phase 2", 1, 4, 71, 95, 24),
            new("Phase 3: Deload and Taper", null, "Phase 3", 1, 3, 96, 114, 18)
        };

        var result = ImportAbsoluteWeeks.NormalizeChunks(chunks);

        Assert.Equal(3, result.Chunks.Count);
        Assert.Equal((1, 6), (result.Chunks[0].WeekFrom, result.Chunks[0].WeekTo));
        Assert.Equal((7, 10), (result.Chunks[1].WeekFrom, result.Chunks[1].WeekTo));
        Assert.Equal((11, 13), (result.Chunks[2].WeekFrom, result.Chunks[2].WeekTo));
        Assert.Equal(2, result.Notices.Count);
        Assert.All(result.Notices, n => Assert.Equal("sequential_cycle_offset", n.Code));
    }

    [Fact]
    public void Already_absolute_chunk_ranges_remain_unshifted()
    {
        var chunks = new List<ImportChunk>
        {
            new("Block 1", "Block 1", "Accumulation", 1, 4, 1, 10, 16),
            new("Block 2", "Block 2", "Intensification", 5, 8, 11, 20, 16),
            new("Block 3", "Block 3", "Realization", 9, 12, 21, 30, 16)
        };

        var result = ImportAbsoluteWeeks.NormalizeChunks(chunks);

        Assert.Equal(3, result.Chunks.Count);
        Assert.Equal((1, 4), (result.Chunks[0].WeekFrom, result.Chunks[0].WeekTo));
        Assert.Equal((5, 8), (result.Chunks[1].WeekFrom, result.Chunks[1].WeekTo));
        Assert.Equal((9, 12), (result.Chunks[2].WeekFrom, result.Chunks[2].WeekTo));
        Assert.Empty(result.Notices);
    }

    [Fact]
    public void Same_week_page_splits_without_phase_boundary_remain_unshifted()
    {
        var chunks = new List<ImportChunk>
        {
            new("Part 1", "Block 1", "Phase 1", 1, 2, 1, 5, 8),
            new("Part 2", "Block 1", "Phase 1", 1, 2, 6, 10, 8)
        };

        var result = ImportAbsoluteWeeks.NormalizeChunks(chunks);

        Assert.Equal(2, result.Chunks.Count);
        Assert.Equal((1, 2), (result.Chunks[0].WeekFrom, result.Chunks[0].WeekTo));
        Assert.Equal((1, 2), (result.Chunks[1].WeekFrom, result.Chunks[1].WeekTo));
        Assert.Single(result.Notices);
        Assert.Equal("ambiguous_overlapping_weeks", result.Notices[0].Code);
    }

    [Fact]
    public void TranslateDays_maps_local_weeks_into_chunk_absolute_range_and_preserves_phase_week()
    {
        var chunk = new ImportChunk("Phase 2", null, "Phase 2", 7, 10, 71, 95, 24);
        var days = new List<DraftWorkout>
        {
            MakeDay("Push 1", week: 1, phaseWeek: 1),
            MakeDay("Pull 1", week: 1, phaseWeek: 1),
            MakeDay("Legs 1", week: 2, phaseWeek: 2),
            MakeDay("Push 2", week: 4, phaseWeek: 4)
        };

        var translated = ImportAbsoluteWeeks.TranslateDays(days, chunk);

        Assert.Equal(4, translated.Count);
        Assert.Equal(7, translated[0].Week);
        Assert.Equal(1, translated[0].PhaseWeek);
        Assert.Equal(7, translated[1].Week);
        Assert.Equal(1, translated[1].PhaseWeek);
        Assert.Equal(8, translated[2].Week);
        Assert.Equal(2, translated[2].PhaseWeek);
        Assert.Equal(10, translated[3].Week);
        Assert.Equal(4, translated[3].PhaseWeek);
    }

    [Fact]
    public void ReconcileChunkCoverage_with_absolute_translation_prevents_week_overload()
    {
        // Existing has Phase 1 (Weeks 1-6), 6 days each
        var existingDays = Enumerable.Range(1, 6)
            .SelectMany(w => Enumerable.Range(1, 6).Select(d => MakeDay($"P1 W{w} D{d}", week: w, phaseWeek: w, page: 35 + w)))
            .ToList();
        var existing = new ImportDraft("PPL Program", existingDays);

        // Extracted has Phase 2 (local weeks 1-4), 6 days each, chunk covers absolute weeks 7-10
        var extractedDays = Enumerable.Range(1, 4)
            .SelectMany(w => Enumerable.Range(1, 6).Select(d => MakeDay($"P2 W{w} D{d}", week: w, phaseWeek: w, page: 71 + w)))
            .ToList();
        var extracted = new ImportDraft("PPL Program", extractedDays);
        var chunk = new ImportChunk("Phase 2", null, "Phase 2", 7, 10, 71, 95, 24);

        var merged = ImportChunkReconciliation.ReconcileChunkCoverage(existing, extracted, chunk);

        var allWorkouts = existing.Workouts.Concat(merged.Workouts).ToList();
        var byWeek = allWorkouts.GroupBy(w => w.Week).ToDictionary(g => g.Key, g => g.Count());

        // Assert 10 distinct weeks exist (1 to 10)
        Assert.Equal(10, byWeek.Count);
        for (var w = 1; w <= 10; w++)
        {
            Assert.True(byWeek.ContainsKey(w), $"Expected week {w} to exist.");
            Assert.True(byWeek[w] <= 7, $"Week {w} had {byWeek[w]} days, exceeding 7-day limit.");
            Assert.Equal(6, byWeek[w]);
        }
    }

    private static DraftWorkout MakeDay(string name, int week, int phaseWeek, int page = 1)
        => new(Guid.NewGuid(), week, name, null, null,
            [new DraftExercise(Guid.NewGuid(), $"{name} Movement", null, null, [new DraftSet(5, 5, 8, 120, null, null, null)], SourcePage: page)],
            "Block 1", "Phase 2", phaseWeek, false, page);
}
