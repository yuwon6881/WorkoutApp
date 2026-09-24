using System.Text.Json;
using System.Text.RegularExpressions;
using Workout.Api.Services;

namespace Workout.Tests.Corpus;

/// A stand-in for the model that transcribes the reader's reconstructed tables exactly as printed:
/// every "DAY LABEL:" starts a day, "WEEK n" headings set its week, rest bands become rest days,
/// and each row under a header becomes an exercise with its printed sets, reps, RPE and rest.
/// What the pipeline does with a faithful read is then all that the report shows.
internal static class TableTranscriber
{
    internal sealed class Model(List<ImportPageText> pages)
    {
        private static readonly Regex PageMarker = new(@"=== PAGE (\d+) ===");

        public string Answer(string requestBody)
        {
            var requested = PageMarker.Matches(requestBody).Select(m => int.Parse(m.Groups[1].Value)).Distinct().ToHashSet();
            var days = Days(pages.Where(p => requested.Contains(p.Page)).ToList());
            if (requestBody.Contains("training_program_outline"))
            {
                var chunks = days.GroupBy(d => d.Week).Select(g => new
                {
                    label = $"Week {g.Key}", block = g.First().Block, phase = (string?)null, weekFrom = g.Key, weekTo = g.Key,
                    pageFrom = g.Min(d => d.Page), pageTo = g.Max(d => d.Page), dayCount = g.Count()
                });
                return JsonSerializer.Serialize(new { programTitle = (string?)null, chunks });
            }
            return JsonSerializer.Serialize(new
            {
                programTitle = (string?)null,
                days = days.Select(d => new
                {
                    block = d.Block, phase = (string?)null, weekNumber = d.Week, phaseWeek = 1, dayName = d.Name, isRestDay = d.Rest,
                    notes = (string?)null, sourcePage = d.Page, exercises = d.Exercises
                })
            });
        }

        private sealed record Day(int Week, string? Block, string? Name, bool Rest, int Page, List<object> Exercises);

        private static List<Day> Days(List<ImportPageText> selected)
        {
            var output = new List<Day>();
            var week = 1;
            string? block = null;
            foreach (var page in selected.OrderBy(p => p.Page))
            {
                string? name = null;
                Dictionary<string, int>? columns = null;
                var exercises = new List<object>();
                void Flush()
                {
                    if (exercises.Count > 0) output.Add(new Day(week, block, name, false, page.Page, exercises));
                    exercises = [];
                }
                foreach (var raw in page.Text.Split('\n'))
                {
                    var line = raw.Trim();
                    if (Regex.Match(line, @"(?:^|[/|:]\s*|PROGRAM:\s*)WEEK\s+(\d{1,2})\b", RegexOptions.IgnoreCase) is { Success: true } w) week = int.Parse(w.Groups[1].Value);
                    if (line.Length < 70 && Regex.Match(line, @"^BLOCK\s+(\d+)", RegexOptions.IgnoreCase) is { Success: true } b) block = $"Block {b.Groups[1].Value}";
                    if (line.StartsWith("DAY LABEL: ")) { Flush(); name = line["DAY LABEL: ".Length..]; columns = null; continue; }
                    if (Regex.IsMatch(line, @"^(?:\d(?:\s*[-–]\s*\d)?\s+)?(?:Optional |Mandatory |Suggested )?Rest Days?$", RegexOptions.IgnoreCase))
                    { Flush(); output.Add(new Day(week, block, "Rest Day", true, page.Page, [])); continue; }
                    var cells = line.Split('|').Select(c => c.Trim()).ToArray();
                    var lower = cells.Select(c => c.ToLowerInvariant()).ToArray();
                    if (lower.Any(c => Regex.IsMatch(c, @"^(?:working\s+)?sets?$|^# of working sets$")) && lower.Any(c => c.StartsWith("rep")))
                    {
                        if (exercises.Count > 0) Flush();
                        columns = lower.Select((c, i) => (c, i)).GroupBy(x => x.c).ToDictionary(g => g.Key, g => g.First().i);
                        if (!lower.Any(c => c is "exercise" or "exercises" or "movement")) columns["exercise"] = 0;
                        continue;
                    }
                    if (columns is null || cells.Length < 4) continue;
                    string? Cell(Func<string, bool> pick) => columns.Where(c => pick(c.Key)).Select(c => c.Value).Where(i => i < cells.Length)
                        .Select(i => cells[i]).FirstOrDefault(v => v.Length > 0);
                    var written = Cell(k => k is "exercise" or "exercises" or "movement") ?? "";
                    if (!Regex.IsMatch(written, "[A-Za-z]") || Regex.IsMatch(written, @"^(?:TOTAL|SESSION|WEEKLY)\b", RegexOptions.IgnoreCase)) continue;
                    var group = Regex.Match(written, @"^([A-Z])\d+[:.]\s*");
                    var sourceName = group.Success ? written[group.Length..] : written;
                    var setsText = Cell(k => k.Contains("working") || Regex.IsMatch(k, @"^sets?$"));
                    var count = int.TryParse(Regex.Match(setsText ?? "", @"\d+").Value, out var n) && n > 0 ? Math.Min(n, 10) : 1;
                    var reps = Cell(k => k.StartsWith("rep")) ?? "";
                    var repMatch = Regex.Match(reps, @"(\d+)(?:\s*[-–]\s*(\d+))?");
                    var (min, max) = repMatch.Success ? (int.Parse(repMatch.Groups[1].Value), int.Parse(repMatch.Groups[2].Success ? repMatch.Groups[2].Value : repMatch.Groups[1].Value)) : (0, 0);
                    var rpeText = Cell(k => (k.Contains("rpe") && !k.Contains("lsrpe")) || k == "ape");
                    double? rpe = double.TryParse(Regex.Match(rpeText ?? "", @"\d+(?:\.\d+)?").Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var r) && r is >= 6 and <= 10 ? r : null;
                    var restText = Cell(k => k.StartsWith("rest"));
                    exercises.Add(new
                    {
                        sequenceGroup = group.Success ? group.Groups[1].Value : null,
                        sourceName, exerciseId = (string?)null, warmupSets = Cell(k => k.StartsWith("warm")), workingSets = count.ToString(),
                        substitutions = new[] { Cell(k => k.Contains("option 1") || k.Contains("sub")), Cell(k => k.Contains("option 2")) }.Where(s => s is not null).ToArray(),
                        coachingNotes = Cell(k => k.StartsWith("note")), notes = (string?)null, sourcePage = page.Page,
                        sets = Enumerable.Range(0, count).Select(_ => new
                        {
                            repMin = min, repMax = max, repsText = reps, targetRpe = rpe, rir = (string?)null, restSeconds = (int?)null,
                            restText, tempo = (string?)null, loadText = (string?)null, notes = (string?)null,
                            repsSource = "extracted", rpeSource = "extracted", restSource = "extracted", sourcePage = page.Page
                        }).ToArray()
                    });
                }
                Flush();
            }
            return output;
        }
    }
}
