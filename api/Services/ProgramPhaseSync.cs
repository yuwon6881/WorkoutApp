using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Rebuilds a saved program's phase rows after its days were rearranged, keeping the identity of
/// every phase that still exists. Finished sessions and substitutions point at a phase by id, so a
/// phase the lifter has already trained in must survive an edit to the weeks after it.
internal sealed class ProgramPhaseSync(AppDb db)
{
    public async Task Sync(TrainingProgram program, IReadOnlyCollection<WorkoutTemplate> days, CancellationToken ct)
    {
        var existing = await db.ProgramPhases.Where(phase => phase.ProgramId == program.Id)
            .OrderBy(phase => phase.Position).ToListAsync(ct);
        var groups = ProgramService.GroupTemplatePhases(days);
        var chosen = new List<ProgramPhase?>(groups.Count);
        var used = new HashSet<Guid>();
        foreach (var group in groups)
        {
            var (block, name) = Identity(group);
            var from = group.Min(day => day.Week);
            // A phase that starts on the same week is the same phase; failing that, the first unused
            // phase with the same name covers a later phase that merely moved.
            var match = existing.FirstOrDefault(phase => !used.Contains(phase.Id) && phase.WeekFrom == from && Same(phase, block, name))
                ?? existing.FirstOrDefault(phase => !used.Contains(phase.Id) && Same(phase, block, name));
            if (match is not null) used.Add(match.Id);
            chosen.Add(match);
        }

        // Positions are unique per program, so clear the old ones before any phase takes a new one.
        var removed = existing.Where(phase => !used.Contains(phase.Id)).ToList();
        db.ProgramPhases.RemoveRange(removed);
        var temporary = -1;
        foreach (var phase in existing.Where(phase => used.Contains(phase.Id))) phase.Position = temporary--;
        if (existing.Count > 0) await db.SaveChangesAsync(ct);

        for (var index = 0; index < groups.Count; index++)
        {
            var group = groups[index];
            var (block, name) = Identity(group);
            var phase = chosen[index];
            if (phase is null)
            {
                phase = new ProgramPhase { UserId = program.UserId, ProgramId = program.Id };
                db.ProgramPhases.Add(phase);
            }
            var pages = group.Select(day => day.SourcePage).Where(page => page is > 0).ToList();
            phase.Position = index;
            phase.Name = name;
            phase.Block = block;
            phase.WeekFrom = group.Min(day => day.Week);
            phase.WeekTo = group.Max(day => day.Week);
            phase.DurationWeeks = phase.WeekTo - phase.WeekFrom + 1;
            phase.SourcePageFrom = pages.Count == 0 ? null : pages.Min();
            phase.SourcePageTo = pages.Count == 0 ? null : pages.Max();
            foreach (var day in group) day.ProgramPhaseId = phase.Id;
        }
    }

    private static (string Block, string Name) Identity(IReadOnlyList<WorkoutTemplate> group)
    {
        var block = group[0].Block.Trim();
        var phase = group[0].Phase.Trim();
        return (block, string.IsNullOrWhiteSpace(phase) ? (string.IsNullOrWhiteSpace(block) ? "Program" : block) : phase);
    }

    private static bool Same(ProgramPhase phase, string block, string name)
        => string.Equals(phase.Block.Trim(), block, StringComparison.OrdinalIgnoreCase)
           && string.Equals(phase.Name.Trim(), name, StringComparison.OrdinalIgnoreCase);
}
