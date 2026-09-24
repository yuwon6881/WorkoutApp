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
        var report = new StringBuilder("# PDF import corpus report\n");
        foreach (var file in Directory.GetFiles(folder, "*.json").Order(StringComparer.OrdinalIgnoreCase))
        {
            report.Append($"\n## {Path.GetFileNameWithoutExtension(file)}\n\n");
            try { report.Append(await Replay(file, catalog)); }
            catch (Exception error) { report.Append($"Import failed: {error.Message}\n"); }
        }
        File.WriteAllText(Path.Combine(folder, "report.md"), report.ToString());
    }

    private static async Task<string> Replay(string file, List<SeedExercise> catalog)
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
        var model = new TableTranscriber.Model(pages);
        var imports = harness.Imports(new StubHandler(request => Respond(model.Answer(request.Content!.ReadAsStringAsync().Result))));
        var created = await imports.Create(new ImportSourceInput(Path.ChangeExtension(Path.GetFileName(file), ".pdf"), extracted.GetProperty("pageCount").GetInt32(), pages, links), default);
        var ready = await imports.Extract(created.Id, default);

        var output = new StringBuilder();
        var days = ready.Draft?.Workouts ?? [];
        output.Append($"- Title: {ready.Draft?.ProgramName}\n- Status: {ready.Status} {ready.Error}\n");
        output.Append($"- Weeks: {days.Select(day => day.Week).Distinct().Count()}, days per week: " +
            $"{string.Join(" ", days.GroupBy(day => day.Week).Select(week => week.Count()))}\n");
        foreach (var slot in ready.Unresolved)
            output.Append($"- Map: {slot.SourceName} ({slot.Occurrences}x)\n");
        foreach (var issue in (ready.ReviewIssues ?? []).Where(issue => issue.Severity != "info"))
            output.Append($"- {issue.Severity}: {issue.Code} p.{issue.SourcePage} {issue.Message}\n");
        var library = await harness.Catalog.MatchIndex(default);
        foreach (var name in PrintedNames(pages).Where(name => !Placeholder.IsMatch(name) && CatalogMatching.Find(library, name) is null))
            output.Append($"- Not in catalog: {name}\n");
        return output.ToString();
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
