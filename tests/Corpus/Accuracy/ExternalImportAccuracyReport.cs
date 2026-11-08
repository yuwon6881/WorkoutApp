using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests.Corpus.Accuracy;

/// Scores the old PDF importer and the ChatGPT JSON import against hand-checked gold files, opt-in and
/// reading nothing from the repository. See Accuracy/README.md for the folder layout.
///
///   set WORKOUT_ACCURACY_CASES=&lt;folder of case folders&gt;
///   set WORKOUT_ACCURACY_OUT=&lt;report folder&gt;   (optional; defaults to &lt;cases&gt;/report)
///   dotnet test tests/Workout.Tests.csproj --filter FullyQualifiedName~ExternalImportAccuracyReport
///
/// Without the variable the test does nothing. With it, a missing input is a failure, never a skip,
/// so an incomplete corpus cannot produce a flattering report.
public sealed class ExternalImportAccuracyReport
{
    [Fact]
    public async Task Scores_every_case_folder_against_its_gold_file()
    {
        var root = Environment.GetEnvironmentVariable("WORKOUT_ACCURACY_CASES");
        if (string.IsNullOrWhiteSpace(root)) return;
        Assert.True(Directory.Exists(root), $"WORKOUT_ACCURACY_CASES does not exist: {root}");
        var cases = Directory.GetDirectories(root).Where(path => !Path.GetFileName(path).Equals("report", StringComparison.OrdinalIgnoreCase))
            .Order(StringComparer.OrdinalIgnoreCase).ToList();
        Assert.True(cases.Count > 0, $"No case folders were found in {root}. Add one folder per source document.");

        var catalog = Json.Read<List<SeedExercise>>(File.ReadAllText(CatalogPath()));
        var harness = await Workout.Tests.Harness.Create();
        await harness.SignIn();
        await harness.Seed([.. catalog]);
        var imports = harness.Imports(new HttpClientHandler());

        var comparisons = new List<AccuracyComparison>();
        var problems = new List<string>();
        foreach (var folder in cases)
        {
            var name = Path.GetFileName(folder);
            try { comparisons.Add(await Compare(imports, folder, name)); }
            catch (Exception error) { problems.Add($"{name}: {error.Message}"); }
        }
        Assert.True(problems.Count == 0, "The accuracy corpus is incomplete or invalid:\n" + string.Join("\n", problems));

        var output = Environment.GetEnvironmentVariable("WORKOUT_ACCURACY_OUT");
        if (string.IsNullOrWhiteSpace(output)) output = Path.Combine(root, "report");
        Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output, "report.md"), AccuracyReport.Markdown(comparisons));
        File.WriteAllText(Path.Combine(output, "report.json"), AccuracyReport.Json(comparisons));
    }

    private static async Task<AccuracyComparison> Compare(ImportService imports, string folder, string name)
    {
        var goldPath = Path.Combine(folder, "gold.json");
        if (!File.Exists(goldPath)) throw new FileNotFoundException("gold.json is missing. Every case needs a hand-checked gold file.");
        var chatGptPath = Path.Combine(folder, "chatgpt.json");
        var legacyPath = Path.Combine(folder, "legacy-draft.json");
        if (!File.Exists(chatGptPath) && !File.Exists(legacyPath))
            throw new FileNotFoundException("Provide chatgpt.json, legacy-draft.json or both; there is nothing to score.");

        // The gold file goes through the same converter as the candidate, so both sides are compared in
        // the form a reviewer would see. A gold file the converter rejects is a mistake in the gold, not a result.
        var goldOffered = (await Convert(imports, File.ReadAllText(goldPath), "gold.json")).Draft
            ?? throw new InvalidOperationException("gold.json produced no draft.");
        // A program that offers alternatives is scored after the same option is chosen on every side, since the
        // old importer's draft only holds the chosen days. selection.txt names the option(s) to score.
        var selection = ReadSelection(folder);
        var gold = Choose(goldOffered, selection, "gold.json");

        AccuracyCase? legacy = File.Exists(legacyPath)
            ? new(name, ImportAccuracyScorer.Score(gold, ReadLegacy(legacyPath), goldOffered), null) : null;
        AccuracyCase? external = null;
        if (File.Exists(chatGptPath))
        {
            try
            {
                var offered = (await Convert(imports, File.ReadAllText(chatGptPath), "chatgpt.json")).Draft;
                external = offered is null ? new AccuracyCase(name, null, "The file produced no draft.")
                    : new AccuracyCase(name, ImportAccuracyScorer.Score(gold, Choose(offered, selection, "chatgpt.json"), goldOffered, offered), null);
            }
            catch (DomainException rejected)
            {
                var path = ExternalImportPath.PathOf(rejected);
                external = new AccuracyCase(name, null, path is null ? rejected.Message : $"{path}: {rejected.Message}");
            }
            catch (InvalidOperationException unselectable)
            {
                external = new AccuracyCase(name, null, unselectable.Message);
            }
        }
        var note = Path.Combine(folder, "unrepresentable.txt");
        return new AccuracyComparison(name, legacy, external, File.Exists(note) ? File.ReadAllText(note) : null);
    }

    /// The alternatives to score, one name per line, matched ignoring case and punctuation. Absent when none are offered.
    private static HashSet<string>? ReadSelection(string folder)
    {
        var path = Path.Combine(folder, "selection.txt");
        return File.Exists(path)
            ? File.ReadAllLines(path).Select(ImportAccuracyScorer.Norm).Where(line => line.Length > 0).ToHashSet() : null;
    }

    /// Applies the chosen option of every group so the draft holds only the days that would be reviewed.
    private static ImportDraft Choose(ImportDraft draft, HashSet<string>? selection, string file)
    {
        while (draft.AlternativeGroups is { Count: > 0 } groups)
        {
            var group = groups[0];
            var member = group.Members.FirstOrDefault(item => selection?.Contains(ImportAccuracyScorer.Norm(item.Name)) == true)
                ?? throw new InvalidOperationException(
                    $"{file} offers alternatives, so selection.txt must name the one to score (one per line). Options: "
                    + string.Join(", ", group.Members.Select(item => $"\"{item.Name}\"")));
            draft = ImportDraftAlternatives.Select(draft, member.Id, group.Id);
        }
        return draft;
    }

    private static Task<ImportView> Convert(ImportService imports, string json, string fileName)
        => imports.CreateExternalImport(json, fileName, default);

    /// Accepts either the draft itself or the whole import view the app returns from GET /api/imports/{id}.
    private static ImportDraft ReadLegacy(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var element = document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("draft", out var draft)
            && draft.ValueKind == JsonValueKind.Object ? draft : document.RootElement;
        return element.Deserialize<ImportDraft>(Json.Options)
            ?? throw new InvalidOperationException("legacy-draft.json is not an import draft.");
    }

    private static string CatalogPath() => CatalogLocation.Path();
}
