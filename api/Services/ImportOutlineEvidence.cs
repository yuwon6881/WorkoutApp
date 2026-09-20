using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// The outline is useful for finding sections, but its structural labels are claims that should
/// agree with the text the browser actually read. This evidence is scoped to one routine at a
/// time so two alternatives may legitimately point at the same physical pages.
internal static class ImportOutlineEvidence
{
    private static readonly Regex BlockHeading = new(@"^BLOCK\s+(?<label>[A-Z0-9][A-Z0-9 -]{0,30})$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex WeekHeading = new(@"^WEEK\s+(?<week>\d+)(?:\s*\|.*)?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PhaseHeading = new(
        @"^(?:INTRO\s+WEEK|DELOAD\s+WEEK|INTRO|MAIN|PEAK|PHASE\s+[A-Z0-9]+(?:\s*[:\-–]\s*[A-Z0-9 &/()\-]+)?|(?:BASE|ACCUMULATION|INTENSIFICATION|HYPERTROPHY|STRENGTH|VOLUME|PEAKING|DELOAD)(?:\s+(?:PHASE|BLOCK|HYPERTROPHY|STRENGTH|VOLUME|INTENSIFICATION|ACCUMULATION|PEAKING))?(?:\s+\d+)?)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    internal sealed record SourceContext(int? Week, string? Block, string? Phase);
    internal sealed record Evidence(
        HashSet<string> SourceLines,
        Dictionary<string, string> Blocks,
        Dictionary<string, string> Phases,
        Dictionary<int, List<SourceContext>> Pages);

    public static Evidence Read(IReadOnlyList<ImportPageText> pages)
    {
        var lines = pages.SelectMany(page => Lines(page.Text)).ToList();
        var sourceLines = lines.Select(Key).Where(value => value.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var blocks = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var phases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines)
        {
            var key = Key(line);
            if (BlockHeading.Match(key) is { Success: true } block)
            {
                var label = $"Block {block.Groups["label"].Value.Trim()}";
                blocks[Key(label)] = label;
            }
            else if (PhaseHeading.IsMatch(key) && IsNotDayOrHeader(key))
            {
                var label = CanonicalPhase(key);
                phases[Key(label)] = label;
            }
        }

        var pageContexts = new Dictionary<int, List<SourceContext>>();
        int? currentWeek = null;
        string? currentBlock = null;
        string? currentPhase = null;
        string? pendingPhase = null;
        foreach (var page in pages.OrderBy(page => page.Page))
        {
            var snapshots = new List<SourceContext>();
            var pageLines = Lines(page.Text).ToList();
            for (var lineIndex = 0; lineIndex < pageLines.Count; lineIndex++)
            {
                var key = Key(pageLines[lineIndex]);
                if (WeekHeading.Match(key) is { Success: true } weekMatch
                    && int.TryParse(weekMatch.Groups["week"].Value, out var week))
                {
                    if (pendingPhase is not null)
                    {
                        currentPhase = pendingPhase;
                        pendingPhase = null;
                    }
                    else if (currentWeek is not null && currentWeek != week && IsWeekSpecific(currentPhase)) currentPhase = null;
                    currentWeek = week;
                    snapshots.Add(new SourceContext(currentWeek, currentBlock, currentPhase));
                    continue;
                }
                if (BlockHeading.Match(key) is { Success: true } blockMatch)
                {
                    currentBlock = $"Block {blockMatch.Groups["label"].Value.Trim()}";
                    snapshots.Add(new SourceContext(currentWeek, currentBlock, currentPhase));
                    continue;
                }
                if (PhaseHeading.IsMatch(key) && IsNotDayOrHeader(key))
                {
                    var phase = CanonicalPhase(key);
                    var appliesToLaterWeek = pageLines.Skip(lineIndex + 1).Any(line => WeekHeading.IsMatch(Key(line)));
                    if (appliesToLaterWeek) pendingPhase = phase;
                    else
                    {
                        currentPhase = phase;
                        snapshots.Add(new SourceContext(currentWeek, currentBlock, currentPhase));
                    }
                }
            }
            if (currentWeek is not null || currentBlock is not null || currentPhase is not null)
                snapshots.Add(new SourceContext(currentWeek, currentBlock, currentPhase));
            pageContexts[page.Page] = snapshots.Distinct().ToList();
        }

        return new Evidence(sourceLines, blocks, phases, pageContexts);
    }

    /// Converts model-proposed labels to source-supported values and merges overlapping ranges.
    /// Page intervals are coalesced per call: callers invoke this separately for the main routine
    /// and each alternative so overlapping pages never merge separate programs.
    public static List<ImportChunk> NormalizeChunks(IEnumerable<AiOutlineChunk> source, Evidence evidence)
    {
        var input = source.ToList();
        Validation.Require(input.Count is > 0 and <= 120, "AI returned an invalid extraction outline.", 422);
        var chunks = input.Select((chunk, index) => new ImportChunk(
            ImportNormalization.Label(chunk.Label, 200, $"Section {index + 1}"),
            SupportedBlock(chunk.Block, evidence), SupportedPhase(chunk.Phase, evidence),
            chunk.WeekFrom, chunk.WeekTo, chunk.PageFrom, chunk.PageTo, chunk.DayCount))
            .ToList();
        Validation.Require(chunks.All(IsValidRange), "AI returned an invalid extraction chunk.", 422);

        var ordered = chunks.Select((chunk, index) => (Chunk: chunk, Index: index))
            .OrderBy(item => item.Chunk.PageFrom).ThenBy(item => item.Chunk.PageTo).ToList();
        var groups = new List<List<(ImportChunk Chunk, int Index)>>();
        foreach (var item in ordered)
        {
            if (groups.Count == 0 || item.Chunk.PageFrom > groups[^1].Max(existing => existing.Chunk.PageTo))
                groups.Add([]);
            groups[^1].Add(item);
        }

        var merged = groups.Select(Merge).OrderBy(item => item.Index).Select(item => item.Chunk).ToList();
        var byPage = merged.OrderBy(chunk => chunk.PageFrom).ToList();
        for (var index = 1; index < byPage.Count; index++)
            Validation.Require(byPage[index].PageFrom > byPage[index - 1].PageTo,
                "Extraction chunks for one routine still overlap after reconciliation.", 422);
        return merged;
    }

    /// Source page/week headings take precedence when they are unambiguous. If a page has two
    /// different alternatives or structural headings, only globally source-supported model labels
    /// survive; an invented label is cleared instead of being stored as structure.
    public static ImportDraft NormalizeDraft(ImportDraft draft, Evidence evidence)
    {
        var workouts = draft.Workouts.Select(workout =>
        {
            var page = workout.SourcePage ?? UniqueSourcePage(workout.Exercises);
            var candidates = new List<SourceContext>();
            if (page is { } pageNumber && evidence.Pages.TryGetValue(pageNumber, out var pageEvidence))
            {
                candidates = pageEvidence.Where(item => item.Week == workout.Week).ToList();
                if (candidates.Count == 0)
                    candidates = pageEvidence.Where(item => item.Week is null).ToList();
                if (candidates.Count == 0) candidates = pageEvidence;
            }

            var structures = candidates.Select(item => (Block: item.Block, Phase: item.Phase)).Distinct().ToList();
            if (structures.Count == 1)
            {
                var (sourceBlock, sourcePhase) = structures[0];
                return workout with
                {
                    Block = sourceBlock ?? SupportedBlock(workout.Block, evidence),
                    Phase = sourcePhase
                };
            }

            return workout with
            {
                Block = SupportedBlock(workout.Block, evidence),
                Phase = SupportedPhase(workout.Phase, evidence)
            };
        }).ToList();
        return draft with { Workouts = workouts };
    }

    private static (ImportChunk Chunk, int Index) Merge(List<(ImportChunk Chunk, int Index)> group)
    {
        if (group.Count == 1) return group[0];
        var chunks = group.Select(item => item.Chunk).ToList();
        var label = chunks.Select(chunk => chunk.Label).Distinct(StringComparer.OrdinalIgnoreCase).Count() == 1
            ? chunks[0].Label : ImportNormalization.Label(chunks[0].Label, 200, "Overlapping section");
        return (new ImportChunk(label,
            OneValue(chunks.Select(chunk => chunk.Block)), OneValue(chunks.Select(chunk => chunk.Phase)),
            chunks.Min(chunk => chunk.WeekFrom), chunks.Max(chunk => chunk.WeekTo),
            chunks.Min(chunk => chunk.PageFrom), chunks.Max(chunk => chunk.PageTo),
            chunks.Max(chunk => chunk.DayCount)), group.Min(item => item.Index));
    }

    private static string? OneValue(IEnumerable<string?> values)
    {
        var distinct = values.Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return distinct.Count == 1 ? distinct[0] : null;
    }

    private static bool IsValidRange(ImportChunk chunk)
        => chunk.DayCount is > 0 and <= 80 && chunk.WeekFrom is > 0 and <= 104
            && chunk.WeekTo >= chunk.WeekFrom && chunk.WeekTo <= 104
            && chunk.PageFrom is > 0 and <= ImportSourceText.MaxPages
            && chunk.PageTo >= chunk.PageFrom && chunk.PageTo <= ImportSourceText.MaxPages;

    private static string? SupportedBlock(string? value, Evidence evidence)
    {
        var key = Key(value);
        if (key.Length == 0) return null;
        if (evidence.Blocks.TryGetValue(key, out var block)) return block;
        if (evidence.SourceLines.Contains(key) && IsNotDayOrHeader(key)) return value!.Trim();
        return null;
    }

    private static string? SupportedPhase(string? value, Evidence evidence)
    {
        var key = Key(value);
        if (key.Length == 0) return null;
        if (evidence.Phases.TryGetValue(key, out var phase)) return phase;
        if (evidence.SourceLines.Contains(key) && IsNotDayOrHeader(key)
            && !WeekHeading.IsMatch(key) && !BlockHeading.IsMatch(key)) return value!.Trim();
        return null;
    }

    private static bool IsNotDayOrHeader(string value)
        => !Regex.IsMatch(value, @"^(?:UPPER|LOWER)\s+\d+$|^ARMS\s*/\s*DELTS$|^(?:PUSH|PULL|LEGS)(?:\s+\d+)?$|^DAY\s+\d+$", RegexOptions.IgnoreCase)
           && !Regex.IsMatch(value, @"^(?:EXERCISE|MOVEMENT|SETS?|REPS?|RPE|RIR|REST|LOAD|WEIGHT|NOTES?|SUBSTITUTION|TRACKING)\b", RegexOptions.IgnoreCase)
           && !Regex.IsMatch(value, @"^(?:SUGGESTED\s+|MANDATORY\s+)?REST\s+DAY$", RegexOptions.IgnoreCase);

    private static string CanonicalPhase(string value)
    {
        var clean = Key(value);
        if (clean.Equals("INTRO WEEK", StringComparison.OrdinalIgnoreCase)) return "Intro Week";
        if (clean.Equals("DELOAD WEEK", StringComparison.OrdinalIgnoreCase)) return "Deload Week";
        if (Regex.Match(clean, @"^PHASE\s+(?<number>[A-Z0-9]+)$", RegexOptions.IgnoreCase) is { Success: true } match)
            return $"Phase {match.Groups["number"].Value}";
        return string.Join(' ', clean.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()));
    }

    private static bool IsWeekSpecific(string? phase)
        => phase is not null && (phase.Equals("Intro Week", StringComparison.OrdinalIgnoreCase)
            || phase.Equals("Deload Week", StringComparison.OrdinalIgnoreCase));

    private static IEnumerable<string> Lines(string? text)
        => (text ?? "").ReplaceLineEndings("\n").Split('\n')
            .Select(line => Regex.Replace(line.Trim(), @"\s+", " "))
            .Where(line => line.Length > 0 && !line.Contains('|'));

    private static string Key(string? value) => Regex.Replace(value?.Trim() ?? "", @"\s+", " ");

    private static int? UniqueSourcePage(List<DraftExercise> exercises)
    {
        var pages = exercises.SelectMany(exercise => new int?[] { exercise.SourcePage }
                .Concat(exercise.Sets.Select(set => set.SourcePage)))
            .Where(page => page.HasValue).Select(page => page.GetValueOrDefault()).Distinct().Take(2).ToList();
        return pages.Count == 1 ? pages[0] : null;
    }
}
