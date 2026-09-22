using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// <summary>
/// Reconciles sequential schedule cycles where later sections restart local week numbers (e.g. 1-4, 1-3).
/// Converts sequential cycle chunk ranges into contiguous absolute program weeks so later cycles do not
/// collapse into the first weeks or exceed the 7-day-per-week limit.
/// </summary>
internal static class ImportAbsoluteWeeks
{
    private static readonly Regex PhaseOrdinal = new(@"\bPhase\s*(\d+)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BlockOrdinal = new(@"\bBlock\s*(\d+)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public sealed record AbsoluteWeeksResult(List<ImportChunk> Chunks, List<ImportReviewIssue> Notices);

    public static AbsoluteWeeksResult NormalizeChunks(IReadOnlyList<ImportChunk> chunks, ImportOutlineEvidence.Evidence? evidence = null)
    {
        if (chunks.Count <= 1)
            return new AbsoluteWeeksResult(chunks.ToList(), []);

        var ordered = chunks.OrderBy(c => c.PageFrom).ThenBy(c => c.PageTo).ToList();
        var notices = new List<ImportReviewIssue>();
        var result = new List<ImportChunk>();

        var currentOffset = 0;
        var previousEndWeek = 0;

        for (var i = 0; i < ordered.Count; i++)
        {
            var chunk = ordered[i];
            if (i == 0)
            {
                result.Add(chunk);
                previousEndWeek = chunk.WeekTo;
                continue;
            }

            var previous = ordered[i - 1];
            var pagesSequential = chunk.PageFrom > previous.PageTo;
            var structureChanged = HasStructuralBoundary(previous, chunk);

            var restartsLocalCycle = pagesSequential && structureChanged &&
                (chunk.WeekFrom <= previous.WeekTo || (chunk.WeekFrom == 1 && previousEndWeek > 1));

            if (restartsLocalCycle)
            {
                currentOffset = previousEndWeek;
                var absoluteWeekFrom = currentOffset + chunk.WeekFrom;
                var absoluteWeekTo = currentOffset + chunk.WeekTo;

                result.Add(chunk with { WeekFrom = absoluteWeekFrom, WeekTo = absoluteWeekTo });
                previousEndWeek = absoluteWeekTo;

                notices.Add(new ImportReviewIssue("sequential_cycle_offset",
                    $"'{chunk.Label}' restarts local week numbering ({chunk.WeekFrom}–{chunk.WeekTo}); mapped to absolute program weeks {absoluteWeekFrom}–{absoluteWeekTo}.",
                    "info", chunk.PageFrom));
            }
            else if (pagesSequential && !structureChanged && chunk.WeekFrom <= previous.WeekTo)
            {
                result.Add(chunk);
                previousEndWeek = Math.Max(previousEndWeek, chunk.WeekTo);
                notices.Add(new ImportReviewIssue("ambiguous_overlapping_weeks",
                    $"'{chunk.Label}' overlaps weeks with '{previous.Label}' on separate pages without a phase change; preserved as parallel/split weeks.",
                    "info", chunk.PageFrom));
            }
            else
            {
                if (currentOffset > 0)
                {
                    if (chunk.WeekFrom > previousEndWeek)
                    {
                        result.Add(chunk);
                        previousEndWeek = chunk.WeekTo;
                    }
                    else
                    {
                        var absoluteWeekFrom = currentOffset + chunk.WeekFrom;
                        var absoluteWeekTo = currentOffset + chunk.WeekTo;
                        result.Add(chunk with { WeekFrom = absoluteWeekFrom, WeekTo = absoluteWeekTo });
                        previousEndWeek = absoluteWeekTo;
                    }
                }
                else
                {
                    result.Add(chunk);
                    previousEndWeek = Math.Max(previousEndWeek, chunk.WeekTo);
                }
            }
        }

        return new AbsoluteWeeksResult(result, notices);
    }

    private static bool HasStructuralBoundary(ImportChunk a, ImportChunk b)
    {
        if (!string.IsNullOrWhiteSpace(a.Block) && !string.IsNullOrWhiteSpace(b.Block)
            && !string.Equals(a.Block.Trim(), b.Block.Trim(), StringComparison.OrdinalIgnoreCase))
            return true;

        if (!string.IsNullOrWhiteSpace(a.Phase) && !string.IsNullOrWhiteSpace(b.Phase)
            && !string.Equals(a.Phase.Trim(), b.Phase.Trim(), StringComparison.OrdinalIgnoreCase))
            return true;

        if (IsDifferentOrdinal(a.Label, b.Label, PhaseOrdinal) || IsDifferentOrdinal(a.Label, b.Label, BlockOrdinal))
            return true;

        return false;
    }

    private static bool IsDifferentOrdinal(string a, string b, Regex pattern)
    {
        var matchA = pattern.Match(a);
        var matchB = pattern.Match(b);
        return matchA.Success && matchB.Success && matchA.Groups[1].Value != matchB.Groups[1].Value;
    }

    public static List<DraftWorkout> TranslateDays(IReadOnlyList<DraftWorkout> days, ImportChunk chunk)
    {
        if (days.Count == 0) return [];
        var minWeek = days.Min(d => d.Week);
        if (minWeek >= chunk.WeekFrom && days.Max(d => d.Week) <= chunk.WeekTo)
            return days.ToList();

        if (minWeek < chunk.WeekFrom)
        {
            var offset = chunk.WeekFrom - minWeek;
            return days.Select(d =>
            {
                var phaseWeek = d.PhaseWeek > 0 ? d.PhaseWeek : d.Week;
                return d with { Week = d.Week + offset, PhaseWeek = phaseWeek };
            }).ToList();
        }

        return days.ToList();
    }
}
