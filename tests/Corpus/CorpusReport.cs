using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests.Corpus;

/// A local check of every PDF in a folder against the real import pipeline, run before a change
/// ships or when a new program arrives. It is opt-in and reads no document from the repository:
///
///   1. From web/: node node_modules/vite-node/vite-node.mjs scripts/pdf-corpus.ts &lt;pdf folder&gt; &lt;out folder&gt;
///   2. From the root: set WORKOUT_PDF_CORPUS=&lt;out folder&gt; and run
///      dotnet test tests/Workout.Tests.csproj --filter FullyQualifiedName~CorpusReport
///
/// &lt;out folder&gt;/report.md then lists, per program, the title it gets, its weeks and days, every
/// slot left to map, every review item above a note, and every printed exercise name the catalog
/// cannot place. The read is the TableTranscriber stand-in, so what it reports is the reader,
/// the reconciliation and the catalog, not the model.
///
/// Every fixture is run with both a faithful and a deliberately drifting reader. The complete
/// semantic drafts must match after source reconciliation; IDs and provider telemetry are ignored.
public sealed class CorpusReport
{
    /// Slots a program leaves for the lifter to choose are mapped in review, not seeded.
    private static readonly Regex Placeholder = new(@"weak point|your choice|pick one|choose one", RegexOptions.IgnoreCase);

    [Fact]
    public async Task Writes_a_report_for_every_extracted_program()
    {
        var folder = Environment.GetEnvironmentVariable("WORKOUT_PDF_CORPUS");
        if (string.IsNullOrWhiteSpace(folder)) return;
        var catalog = Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()));
        var files = Directory.GetFiles(folder, "*.json").Order(StringComparer.OrdinalIgnoreCase).ToArray();
        var fixtureFilter = Environment.GetEnvironmentVariable("WORKOUT_CORPUS_FILTER");
        if (!string.IsNullOrWhiteSpace(fixtureFilter))
        {
            var requested = fixtureFilter.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            files = files.Where(file => requested.Contains(Path.GetFileNameWithoutExtension(file))).ToArray();
            var found = files.Select(file => Path.GetFileNameWithoutExtension(file)!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            Assert.True(requested.SetEquals(found),
                $"Requested corpus fixtures are missing: {string.Join(", ", requested.Except(found))}");
        }
        Assert.NotEmpty(files);
        var expectations = JsonSerializer.Deserialize<Dictionary<string, CorpusExpectation>>(
            File.ReadAllText(ExpectedPath()), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        var present = files.Select(Path.GetFileNameWithoutExtension).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selectedExpectations = expectations.Keys.Where(name => string.IsNullOrWhiteSpace(fixtureFilter) || present.Contains(name));
        var missingFixtures = selectedExpectations.Where(name => !present.Contains(name)).ToList();
        Assert.True(missingFixtures.Count == 0, $"Required corpus fixtures are missing: {string.Join(", ", missingFixtures)}");

        var report = new StringBuilder("# PDF import corpus report\n");
        var failures = new List<string>();

        foreach (var file in files)
        {
            var programName = Path.GetFileNameWithoutExtension(file);
            report.Append($"\n## {programName}\n\n");
            try
            {
                var expected = expectations.GetValueOrDefault(programName);
                var discovered = await Replay(file, catalog, drifting: false, selectedAlternativeId: null, stopAtChoice: true);
                if (discovered.View.Stage == "select")
                {
                    var alternatives = discovered.View.Alternatives ?? [];
                    ValidateAlternativeInventory(programName, alternatives, expected, failures);
                    foreach (var alternative in alternatives)
                    {
                        report.Append($"### Alternative: {alternative.Name}\n\n");
                        var normal = await Replay(file, catalog, drifting: false, selectedAlternativeId: alternative.Id);
                        var drift = await Replay(file, catalog, drifting: true, selectedAlternativeId: alternative.Id);
                        AppendViewReport(report, normal.View, normal.Pages, normal.Library, file, alternative.Id,
                            $"{programName} ({alternative.Name})", failures, drifting: false, expected);
                        AppendViewReport(report, drift.View, drift.Pages, drift.Library, file, alternative.Id,
                            $"{programName} ({alternative.Name}, drifting)", failures, drifting: true, expected);
                        CompareSemantics(normal.View.Draft, normal.CanonicalNames,
                            drift.View.Draft, drift.CanonicalNames,
                            $"{programName} ({alternative.Name})", failures);
                    }
                    if (expected?.Alternatives is null)
                        failures.Add($"{programName}: selection was required, but no independent alternative inventory is configured.");
                }
                else
                {
                    if (expected?.Alternatives is { Count: > 0 })
                        failures.Add($"{programName}: expected a version chooser, received stage '{discovered.View.Stage}'.");
                    var normal = await Replay(file, catalog, drifting: false, selectedAlternativeId: null);
                    var drift = await Replay(file, catalog, drifting: true, selectedAlternativeId: null);
                    AppendViewReport(report, normal.View, normal.Pages, normal.Library, file, null, programName, failures, drifting: false, expected);
                    AppendViewReport(report, drift.View, drift.Pages, drift.Library, file, null, $"{programName} (drifting)", failures, drifting: true, expected);
                    CompareSemantics(normal.View.Draft, normal.CanonicalNames,
                        drift.View.Draft, drift.CanonicalNames, programName, failures);
                    if (expected?.ExerciseCount is { } exercises && normal.View.Draft is { } draft)
                    {
                        var actualExercises = draft.Workouts.Sum(day => day.Exercises.Count);
                        var actualSets = draft.Workouts.SelectMany(day => day.Exercises).Sum(exercise => exercise.Sets.Count);
                        if (actualExercises != exercises || actualSets != expected.SetCount)
                            failures.Add($"{programName}: source-reviewed inventory expected {exercises} exercises/{expected.SetCount} sets, got {actualExercises}/{actualSets}.");
                    }
                }
            }
            catch (Exception error)
            {
                report.Append($"Import failed: {error.Message}\n");
                failures.Add($"{programName}: Import exception: {error.GetBaseException()}");
            }
        }
        File.WriteAllText(Path.Combine(folder, "report.md"), report.ToString());
        Assert.True(failures.Count == 0, $"Corpus execution had {failures.Count} failures:\n{string.Join("\n", failures)}");
    }

    private sealed record CorpusExpectation(List<ExpectedAlternative>? Alternatives = null, int? ExerciseCount = null,
        int? SetCount = null, ExpectedFailure? ExpectedFailure = null);
    private sealed record ExpectedAlternative(string Id, string Name, int PageFrom, int PageTo, int WeekCount, int SessionsPerWeek);
    private sealed record ExpectedFailure(string Code, int Page, string TargetField);
    private sealed record ReplayResult(ImportView View, List<ImportPageText> Pages, Dictionary<string, Guid> Library,
        Dictionary<Guid, string> CanonicalNames);

    private static async Task<ReplayResult> Replay(string file, List<SeedExercise> catalog, bool drifting,
        string? selectedAlternativeId, bool stopAtChoice = false)
    {
        var extracted = JsonDocument.Parse(File.ReadAllText(file)).RootElement;
        var pages = extracted.GetProperty("pages").EnumerateArray()
            .Select(page => new ImportPageText(page.GetProperty("page").GetInt32(), page.GetProperty("text").GetString()!)).ToList();
        var links = extracted.GetProperty("links").EnumerateArray()
            .Select(link => new ImportPageLink(link.GetProperty("page").GetInt32(), link.GetProperty("name").GetString()!,
                link.GetProperty("url").GetString()!)).ToList();

        await using var harness = await Harness.Create(new() { ["OpenAi:ApiKey"] = "local", ["OpenAi:Model"] = "local" });
        await harness.SignIn();
        await harness.Seed([.. catalog]);
        var model = new TableTranscriber.Model(pages, drifting);
        var imports = harness.Imports(new StubHandler(request => Respond(model.Answer(request.Content!.ReadAsStringAsync().Result))));
        var created = await imports.Create(new ImportSourceInput(Path.ChangeExtension(Path.GetFileName(file), ".pdf"), extracted.GetProperty("pageCount").GetInt32(), pages, links), default);
        var ready = created;
        if (ready.Status == "pending" && ready.Stage == "outline") ready = await imports.Extract(created.Id, default);
        if (stopAtChoice)
        {
            var choiceLibrary = await harness.Catalog.MatchIndex(default);
            return new ReplayResult(ready, pages, choiceLibrary, CanonicalNames(await harness.Catalog.All(default)));
        }
        if (selectedAlternativeId is not null)
        {
            if (ready.Stage != "select") throw new InvalidOperationException($"Expected stage=select before choosing '{selectedAlternativeId}', received '{ready.Stage}'.");
            if (!(ready.Alternatives ?? []).Any(alternative => alternative.Id == selectedAlternativeId))
                throw new InvalidOperationException($"The selection stage did not offer expected alternative '{selectedAlternativeId}'.");
            ready = await imports.SelectAlternative(created.Id, selectedAlternativeId, default);
        }
        var library = await harness.Catalog.MatchIndex(default);
        var progressChecks = 0;
        while (ready.Status == "pending" && ready.Stage is "extract" or "verify" or "recover")
        {
            if (++progressChecks > Math.Max(3, ready.ChunksTotal + 2))
                throw new InvalidOperationException("Extraction exceeded its bounded progress checks.");
            var previous = ready;
            try { ready = await imports.Extract(created.Id, default); }
            catch (Workout.Api.Domain.DomainException)
            {
                ready = await imports.Get(created.Id, default);
                if (ready.Status != "failed") throw;
            }
            if (ready.Status == "pending" && ready.Stage == "extract"
                && ready.ChunksDone <= previous.ChunksDone && ready.Revision <= previous.Revision)
                throw new InvalidOperationException("Extraction made no observable progress.");
        }
        return new ReplayResult(ready, pages, library, CanonicalNames(await harness.Catalog.All(default)));
    }

    private static Dictionary<Guid, string> CanonicalNames(List<CatalogExercise> catalog)
        => catalog.ToDictionary(exercise => exercise.Id, exercise => exercise.Name);

    private static void AppendViewReport(StringBuilder output, ImportView ready, List<ImportPageText> pages,
        Dictionary<string, Guid> library, string file, string? altId, string label, List<string> failures, bool drifting,
        CorpusExpectation? expected = null)
    {
        var days = ready.Draft?.Workouts ?? [];
        if (Environment.GetEnvironmentVariable("WORKOUT_CORPUS_DUMP") == "1")
        {
            var suffix = (altId is null ? "" : $".{altId}") + (drifting ? ".drift.draft" : ".draft");
            File.WriteAllText(Path.ChangeExtension(file, suffix), Json.Write(ready.Draft));
        }

        output.Append($"- Title: {ready.Draft?.ProgramName}\n- Status: {ready.Status} {ready.Error}\n");
        output.Append($"- Weeks: {days.Select(day => day.Week).Distinct().Count()}, days per week: " +
            $"{string.Join(" ", days.GroupBy(day => day.Week).Select(week => week.Count()))}\n");
        output.Append(Digest(days));
        output.Append($"- Model reads: {ready.InputTokens}\n");
        output.Append($"- Notes:{string.Join(", ", (ready.ReviewIssues ?? []).Where(issue => issue.Severity == "info").Select(issue => issue.Code).Distinct().Order())}\n");
        foreach (var slot in ready.Unresolved)
            output.Append($"- Map: {slot.SourceName} ({slot.Occurrences}x)\n");
        foreach (var issue in (ready.ReviewIssues ?? []).Where(issue => issue.Severity != "info"))
            output.Append($"- {issue.Severity}: {issue.Code} p.{issue.SourcePage} {issue.Message}\n");
        foreach (var name in PrintedNames(pages).Where(name => !Placeholder.IsMatch(name) && CatalogMatching.Find(library, name) is null))
            output.Append($"- Not in catalog: {name}\n");

        if (expected?.ExpectedFailure is { } expectedFailure)
        {
            if (ready.Status != "failed")
                failures.Add($"{label}: Expected a structured source failure, received status '{ready.Status}'.");
            var matchingIssues = (ready.ReviewIssues ?? []).Where(issue => issue.Code == expectedFailure.Code
                && issue.SourcePage == expectedFailure.Page && issue.TargetField == expectedFailure.TargetField).ToList();
            if (matchingIssues.Count != 1)
                failures.Add($"{label}: Expected exactly one {expectedFailure.Code} issue on page {expectedFailure.Page} " +
                    $"for {expectedFailure.TargetField}, received {matchingIssues.Count}.");
            if (ready.Draft is not { Workouts.Count: > 0 })
                failures.Add($"{label}: The unresolved import did not retain its source-reconciled draft for review.");
            return;
        }

        // Assertions for the clean import gate
        if (ready.Status != "ready")
            failures.Add($"{label}: Status is '{ready.Status}', expected 'ready'. Error: {ready.Error}");
        var actionableIssues = (ready.ReviewIssues ?? []).Where(issue => issue.Severity != "info").ToList();
        if (actionableIssues.Count > 0)
            failures.Add($"{label}: Has {actionableIssues.Count} actionable review issue(s): {string.Join(", ", actionableIssues.Select(i => $"{i.Severity}:{i.Code} p.{i.SourcePage}"))}");
        var invalidSlots = ready.Unresolved.Where(s => Regex.IsMatch(s.SourceName, @"^(?:N/?A|REST)$|\b(?:WEEKLY|SESSION|TOTAL)\s+.*VOLUME\b", RegexOptions.IgnoreCase)).ToList();
        if (invalidSlots.Count > 0)
            failures.Add($"{label}: Unresolved slots contain debris: {string.Join(", ", invalidSlots.Select(s => s.SourceName))}");
        var weeks = days.Select(d => d.Week).Distinct().Order().ToList();
        if (weeks.Count > 0)
        {
            var expectedWeeks = Enumerable.Range(1, weeks.Count).ToList();
            if (!weeks.SequenceEqual(expectedWeeks))
                failures.Add($"{label}: Weeks are not contiguous 1..N: found {string.Join(", ", weeks)}");
            foreach (var weekGroup in days.GroupBy(d => d.Week))
            {
                if (weekGroup.Count() > 14)
                    failures.Add($"{label}: Week {weekGroup.Key} has {weekGroup.Count()} days, exceeding limit 14");
            }
        }
    }

    /// A compact report checksum includes every prescription field on every set.
    private static string Digest(List<DraftWorkout> days)
    {
        var exercises = days.SelectMany(day => day.Exercises).ToList();
        var semantic = SemanticContent(new ImportDraft("", days), new Dictionary<Guid, string>());
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(semantic)))[..8];
        var order = string.Join(" | ", days.GroupBy(day => day.Week)
            .Select(week => $"W{week.Key}: {string.Join(", ", week.Select(day => day.IsRestDay ? "Rest" : day.Name))}"));
        return $"- Digest: {exercises.Count} exercises, {exercises.Sum(exercise => exercise.Sets.Count)} sets, values {checksum}\n- Order: {order}\n";
    }

    private static void ValidateAlternativeInventory(string programName, List<ImportAlternative> actual,
        CorpusExpectation? expected, List<string> failures)
    {
        if (expected?.Alternatives is not { Count: > 0 } required)
        {
            failures.Add($"{programName}: version selection is present, but its independently reviewed inventory is missing.");
            return;
        }
        var actualIds = actual.Select(alternative => alternative.Id).Order(StringComparer.OrdinalIgnoreCase).ToList();
        var expectedIds = required.Select(alternative => alternative.Id).Order(StringComparer.OrdinalIgnoreCase).ToList();
        if (!actualIds.SequenceEqual(expectedIds, StringComparer.OrdinalIgnoreCase))
            failures.Add($"{programName}: expected variants [{string.Join(", ", expectedIds)}], received [{string.Join(", ", actualIds)}].");

        foreach (var source in required)
        {
            var alternative = actual.SingleOrDefault(item => item.Id.Equals(source.Id, StringComparison.OrdinalIgnoreCase));
            if (alternative is null)
            {
                failures.Add($"{programName}: required alternative '{source.Id}' was not offered.");
                continue;
            }
            var chunks = alternative.Chunks ?? [];
            var pageFrom = chunks.Count == 0 ? 0 : chunks.Min(chunk => chunk.PageFrom);
            var pageTo = chunks.Count == 0 ? 0 : chunks.Max(chunk => chunk.PageTo);
            if (!alternative.Name.Equals(source.Name, StringComparison.OrdinalIgnoreCase)
                || alternative.WeekCount != source.WeekCount || alternative.SessionsPerWeek != source.SessionsPerWeek
                || pageFrom != source.PageFrom || pageTo != source.PageTo)
            {
                failures.Add($"{programName}: variant '{source.Id}' metadata/pages differed from its reviewed source inventory " +
                    $"(name={alternative.Name}, weeks={alternative.WeekCount}, sessions/week={alternative.SessionsPerWeek}, pages={pageFrom}-{pageTo}).");
            }
        }
    }

    private static void CompareSemantics(ImportDraft? normal, Dictionary<Guid, string> normalNames,
        ImportDraft? drifting, Dictionary<Guid, string> driftingNames, string label, List<string> failures)
    {
        if (normal is null || drifting is null)
        {
            failures.Add($"{label}: normal and drifting runs must both return a complete draft.");
            return;
        }
        if (!string.Equals(SemanticContent(normal, normalNames), SemanticContent(drifting, driftingNames), StringComparison.Ordinal))
        {
            var detail = FirstSemanticDifference(normal, normalNames, drifting, driftingNames)
                ?? "The first difference is in an unclassified semantic field.";
            failures.Add($"{label}: source reconciliation did not recover semantic equality after a drifting read. {detail}");
        }
    }

    private static string? FirstSemanticDifference(ImportDraft normal, IReadOnlyDictionary<Guid, string> normalNames,
        ImportDraft drifting, IReadOnlyDictionary<Guid, string> driftingNames)
    {
        if (!string.Equals(normal.ProgramName, drifting.ProgramName, StringComparison.Ordinal))
            return $"Program name differs: '{normal.ProgramName}' vs '{drifting.ProgramName}'.";
        if (normal.SourceWeekDays != drifting.SourceWeekDays)
            return $"Source week length differs: {normal.SourceWeekDays} vs {drifting.SourceWeekDays}.";
        if (normal.Workouts.Count != drifting.Workouts.Count)
            return $"Workout count differs: {normal.Workouts.Count} vs {drifting.Workouts.Count}.";
        for (var dayIndex = 0; dayIndex < Math.Min(normal.Workouts.Count, drifting.Workouts.Count); dayIndex++)
        {
            var left = normal.Workouts[dayIndex];
            var right = drifting.Workouts[dayIndex];
            if (left.Week != right.Week || left.Name != right.Name || left.Focus != right.Focus || left.Notes != right.Notes
                || left.Block != right.Block || left.Phase != right.Phase || left.PhaseWeek != right.PhaseWeek
                || left.IsRestDay != right.IsRestDay || left.SourcePage != right.SourcePage)
                return $"Workout {dayIndex + 1} metadata differs ('{left.Name}', week {left.Week}, page {left.SourcePage} vs '{right.Name}', week {right.Week}, page {right.SourcePage}).";
            if (left.Exercises.Count != right.Exercises.Count)
                return $"Workout '{left.Name}' exercise count differs: {left.Exercises.Count} vs {right.Exercises.Count}. " +
                    $"Normal: [{string.Join(", ", left.Exercises.Select(exercise => exercise.SourceName))}]; " +
                    $"drifting: [{string.Join(", ", right.Exercises.Select(exercise => exercise.SourceName))}].";
            for (var exerciseIndex = 0; exerciseIndex < left.Exercises.Count; exerciseIndex++)
            {
                var normalExercise = left.Exercises[exerciseIndex];
                var driftExercise = right.Exercises[exerciseIndex];
                var normalName = normalExercise.ExerciseId is { } normalId ? normalNames.GetValueOrDefault(normalId) : null;
                var driftName = driftExercise.ExerciseId is { } driftId ? driftingNames.GetValueOrDefault(driftId) : null;
                if (normalExercise.SourceName != driftExercise.SourceName || normalName != driftName
                    || normalExercise.Notes != driftExercise.Notes || normalExercise.SequenceGroup != driftExercise.SequenceGroup
                    || normalExercise.SourcePage != driftExercise.SourcePage || normalExercise.RestSeconds != driftExercise.RestSeconds
                    || !(normalExercise.Substitutions ?? []).SequenceEqual(driftExercise.Substitutions ?? [])
                    || normalExercise.DemoUrl != driftExercise.DemoUrl || !DictionaryEqual(normalExercise.DemoLinks, driftExercise.DemoLinks))
                    return $"Exercise '{normalExercise.SourceName}' differs at workout '{left.Name}' " +
                        $"(mapped '{normalName ?? "unmapped"}' vs '{driftName ?? "unmapped"}', rest {normalExercise.RestSeconds}/{driftExercise.RestSeconds}, " +
                        $"notes '{normalExercise.Notes}'/'{driftExercise.Notes}').";
                if (normalExercise.Sets.Count != driftExercise.Sets.Count)
                    return $"Exercise '{normalExercise.SourceName}' set count differs: {normalExercise.Sets.Count} vs {driftExercise.Sets.Count}.";
                for (var setIndex = 0; setIndex < normalExercise.Sets.Count; setIndex++)
                {
                    var normalSet = normalExercise.Sets[setIndex];
                    var driftSet = driftExercise.Sets[setIndex];
                    if (normalSet.RepMin != driftSet.RepMin || normalSet.RepMax != driftSet.RepMax
                        || normalSet.TargetRpe != driftSet.TargetRpe || normalSet.RestSeconds != driftSet.RestSeconds
                        || normalSet.Tempo != driftSet.Tempo || normalSet.LoadText != driftSet.LoadText
                        || normalSet.Notes != driftSet.Notes || normalSet.RepsSource != driftSet.RepsSource
                        || normalSet.RpeSource != driftSet.RpeSource || normalSet.RestSource != driftSet.RestSource
                        || normalSet.RepsText != driftSet.RepsText || normalSet.RestText != driftSet.RestText
                        || normalSet.Rir != driftSet.Rir || normalSet.Warmup != driftSet.Warmup
                        || normalSet.SourcePage != driftSet.SourcePage)
                        return $"Exercise '{normalExercise.SourceName}' set {setIndex + 1} differs in workout '{left.Name}' " +
                            $"(reps {normalSet.RepsText ?? $"{normalSet.RepMin}-{normalSet.RepMax}"}/{driftSet.RepsText ?? $"{driftSet.RepMin}-{driftSet.RepMax}"}, " +
                            $"RPE {normalSet.TargetRpe}/{driftSet.TargetRpe}, rest {normalSet.RestText ?? normalSet.RestSeconds?.ToString()}/{driftSet.RestText ?? driftSet.RestSeconds?.ToString()}, " +
                            $"load {normalSet.LoadText}/{driftSet.LoadText}, notes {normalSet.Notes}/{driftSet.Notes}).";
                }
            }
        }
        return null;
    }

    private static bool DictionaryEqual(Dictionary<string, string>? left, Dictionary<string, string>? right)
        => left is null ? right is null : right is not null && left.Count == right.Count
            && left.All(item => right.TryGetValue(item.Key, out var value) && value == item.Value);

    /// Stable import content only. Runtime line/slot IDs, model telemetry, retries and timestamps
    /// are intentionally omitted; ordering and every workout, exercise and set field are retained.
    private static string SemanticContent(ImportDraft draft, IReadOnlyDictionary<Guid, string> canonicalNames)
    {
        var content = new
        {
            draft.ProgramName,
            draft.SourceWeekDays,
            Workouts = draft.Workouts.Select(day => new
            {
                day.Week, day.Name, day.Focus, day.Notes, day.Block, day.Phase, day.PhaseWeek,
                day.IsRestDay, day.SourcePage,
                Exercises = day.Exercises.Select(exercise => new
                {
                    exercise.SourceName,
                    MappedExercise = exercise.ExerciseId is { } id
                        ? canonicalNames.GetValueOrDefault(id, "<unknown catalog exercise>")
                        : null,
                    exercise.Notes, exercise.SequenceGroup,
                    exercise.Substitutions, exercise.SourcePage, exercise.RestSeconds, exercise.DemoUrl,
                    exercise.DemoLinks,
                    Sets = exercise.Sets.Select(set => new
                    {
                        set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.LoadText,
                        set.Notes, set.RepsSource, set.RpeSource, set.RestSource, set.RepsText, set.RestText,
                        set.Rir, set.Warmup, set.SourcePage
                    })
                })
            })
        };
        return JsonSerializer.Serialize(content);
    }

    private static string ExpectedPath()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "tests", "Corpus", "CorpusExpected.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("tests/Corpus/CorpusExpected.json was not found.");
    }

    /// Every name printed in a table's exercise or substitution column.
    private static IEnumerable<string> PrintedNames(List<ImportPageText> pages)
    {
        var names = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var page in pages)
        {
            List<int>? columns = null;
            foreach (var line in page.Text.Split('\n'))
            {
                var cells = line.Split('|').Select(cell => cell.Trim()).ToArray();
                var lower = cells.Select(cell => cell.ToLowerInvariant()).ToArray();
                if (lower.Any(cell => Regex.IsMatch(cell, @"^(?:# of )?(?:working\s+)?sets?$")) && lower.Any(cell => cell.StartsWith("rep")))
                {
                    var name = Array.FindIndex(lower, cell => cell is "exercise" or "exercises" or "movement");
                    columns = [name >= 0 ? name : 0, .. Enumerable.Range(0, lower.Length).Where(index => lower[index].Contains("option"))];
                    continue;
                }
                if (columns is null || cells.Length < 4) continue;
                foreach (var index in columns.Where(index => index < cells.Length))
                {
                    var written = Regex.Replace(cells[index], @"^[A-Z]\d+[:.]\s*", "").Trim();
                    written = Regex.Replace(written, @"\s+(?:\d+\s+)?(?:WEEKLY|SESSION|TOTAL)\s+.*VOLUME.*$", "", RegexOptions.IgnoreCase).Trim();
                    if (written.Length >= 4 && Regex.IsMatch(written, "[A-Za-z]{3}")
                        && !Regex.IsMatch(written, @"^(?:N/A|See |TOTAL|SESSION|WEEKLY|-)", RegexOptions.IgnoreCase))
                        names.Add(written);
                }
            }
        }
        return names;
    }

    private static HttpResponseMessage Respond(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"status":"completed","usage":{"input_tokens":1,"output_tokens":1},"output":[{"content":[{"type":"output_text","text":{{JsonSerializer.Serialize(body)}}}]}]}""")
    };

    private static string CatalogPath()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "deploy", "exercises.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("deploy/exercises.json was not found.");
    }
}
