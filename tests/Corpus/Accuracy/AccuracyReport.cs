using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Workout.Tests.Corpus.Accuracy;

/// One source document: the old importer's score and the ChatGPT file's score against the same gold.
/// A null score means the file never became a draft; <see cref="RejectedReason"/> says why, and no
/// accuracy number is invented for it.
public sealed record AccuracyCase(string Name, AccuracyScore? Score, string? RejectedReason);

public sealed record AccuracySummary(
    int Files, int Scored, int Rejected, double? MeanFieldAccuracy, int TotalCorrectionEdits, int TotalMissingDays,
    int TotalMissingExercises)
{
    public static AccuracySummary Of(IReadOnlyCollection<AccuracyCase> cases)
    {
        var scored = cases.Where(item => item.Score is not null).Select(item => item.Score!).ToList();
        return new AccuracySummary(
            cases.Count, scored.Count, cases.Count - scored.Count,
            scored.Count == 0 ? null : scored.Average(score => score.FieldAccuracy),
            scored.Sum(score => score.CorrectionEdits), scored.Sum(score => score.MissingDays),
            scored.Sum(score => score.MissingExercises));
    }
}

public sealed record AccuracyComparison(string Name, AccuracyCase? Legacy, AccuracyCase? External, string? Unrepresentable);

public static class AccuracyReport
{
    private const string Caveat =
        "> **Read this first.** These numbers describe only the files in this run, scored against gold files a person\n" +
        "> checked by hand. They are not a general accuracy claim. A file that failed validation has no score and is\n" +
        "> listed as rejected, never counted as zero or dropped. \"Corrections\" counts edits a reviewer would have to make\n" +
        "> (add or delete a day, exercise or set; fix one field). It is a proxy for effort, not measured time.";

    public static string Markdown(IReadOnlyList<AccuracyComparison> comparisons)
    {
        var report = new StringBuilder("# External import accuracy report\n\n").AppendLine(Caveat).AppendLine();
        var legacy = AccuracySummary.Of([.. comparisons.Select(item => item.Legacy).OfType<AccuracyCase>()]);
        var external = AccuracySummary.Of([.. comparisons.Select(item => item.External).OfType<AccuracyCase>()]);

        report.AppendLine("## Summary\n");
        report.AppendLine("| | Old PDF importer | ChatGPT JSON |");
        report.AppendLine("|---|---|---|");
        report.AppendLine($"| Files with a result | {legacy.Files} | {external.Files} |");
        report.AppendLine($"| Rejected (no draft) | {legacy.Rejected} | {external.Rejected} |");
        report.AppendLine($"| Mean field accuracy (scored files) | {Percent(legacy.MeanFieldAccuracy)} | {Percent(external.MeanFieldAccuracy)} |");
        report.AppendLine($"| Total corrections (scored files) | {legacy.TotalCorrectionEdits} | {external.TotalCorrectionEdits} |");
        report.AppendLine($"| Missing days | {legacy.TotalMissingDays} | {external.TotalMissingDays} |");
        report.AppendLine($"| Missing exercises | {legacy.TotalMissingExercises} | {external.TotalMissingExercises} |");
        report.AppendLine();
        if (legacy.Scored != external.Scored || legacy.Files != external.Files)
            report.AppendLine("Totals are not comparable while the two columns cover different files; compare the per-file rows.\n");

        foreach (var item in comparisons)
        {
            report.AppendLine($"## {item.Name}\n");
            AppendCase(report, "Old PDF importer", item.Legacy);
            AppendCase(report, "ChatGPT JSON", item.External);
            if (!string.IsNullOrWhiteSpace(item.Unrepresentable))
                report.AppendLine($"**Not representable in the external format (noted by the reviewer):**\n\n{item.Unrepresentable.Trim()}\n");
        }
        return report.ToString();
    }

    public static string Json(IReadOnlyList<AccuracyComparison> comparisons) => JsonSerializer.Serialize(new
    {
        caveat = Caveat,
        legacy = AccuracySummary.Of([.. comparisons.Select(item => item.Legacy).OfType<AccuracyCase>()]),
        external = AccuracySummary.Of([.. comparisons.Select(item => item.External).OfType<AccuracyCase>()]),
        files = comparisons
    }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });

    private static void AppendCase(StringBuilder report, string heading, AccuracyCase? item)
    {
        report.AppendLine($"### {heading}\n");
        if (item is null) { report.AppendLine("No input was provided for this column.\n"); return; }
        if (item.Score is null) { report.AppendLine($"Rejected, no draft was created: {item.RejectedReason}\n"); return; }
        var score = item.Score;
        report.AppendLine($"- Field accuracy: {Percent(score.FieldAccuracy)}");
        report.AppendLine($"- Corrections needed: {score.CorrectionEdits}");
        report.AppendLine($"- Days: {score.MatchedDays}/{score.GoldDays} matched, {score.MissingDays} missing, {score.ExtraDays} extra");
        report.AppendLine($"- Exercises: {score.MatchedExercises}/{score.GoldExercises} matched, {score.MissingExercises} missing, {score.ExtraExercises} extra");
        report.AppendLine($"- Sets: {score.MissingSets} missing, {score.ExtraSets} extra of {score.GoldSets} expected\n");
        report.AppendLine("| Field | Matched | Total | Rate |");
        report.AppendLine("|---|---|---|---|");
        foreach (var (field, tally) in score.Fields.Where(pair => pair.Value.Total > 0))
            report.AppendLine($"| {field} | {tally.Matched} | {tally.Total} | {Percent(tally.Rate)} |");
        report.AppendLine();
        if (score.Differences.Count > 0)
        {
            report.AppendLine("<details><summary>Differences</summary>\n");
            foreach (var difference in score.Differences) report.AppendLine($"- {difference}");
            report.AppendLine("\n</details>\n");
        }
    }

    private static string Percent(double? rate) => rate is null ? "n/a" : (rate.Value * 100).ToString("0.0", CultureInfo.InvariantCulture) + "%";
}
