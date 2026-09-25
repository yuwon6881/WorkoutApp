using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Workout.Api.Services;

namespace Workout.Tests.Corpus;

/// A stand-in for the model that transcribes the reader's reconstructed tables exactly as printed:
/// every "DAY LABEL:" starts a day, "WEEK n" headings set its week, rest bands become rest days,
/// and each row under a header becomes an exercise with its printed sets, reps, RPE and rest.
/// What the pipeline does with a faithful read is then all that the report shows.
///
/// With WORKOUT_CORPUS_DRIFT=1 it instead makes the mistakes real reads have made, always on the
/// same rows so two runs compare: it title-cases a name, adds a nameless and set-less exercise,
/// drops a day's last exercise, replaces a printed rest with 90 seconds, and moves a rest day one
/// slot earlier. Each choice is keyed on the page and position, never on how pages were sectioned.
internal static class TableTranscriber
{
    internal static bool Drifting => Environment.GetEnvironmentVariable("WORKOUT_CORPUS_DRIFT") == "1";

    internal sealed class Model(List<ImportPageText> pages, bool drifting)
    {
        private static readonly Regex PageMarker = new(@"=== PAGE (\d+) ===");
        private readonly List<Day> allDays = Days(pages);

        public string Answer(string requestBody)
        {
            var requested = PageMarker.Matches(requestBody).Select(m => int.Parse(m.Groups[1].Value)).Distinct().ToHashSet();
            if (requestBody.Contains("training_program_outline"))
            {
                var alternatives = DetectAlternatives(pages);
                if (alternatives.Count > 1)
                {
                    return JsonSerializer.Serialize(new
                    {
                        programTitle = (string?)null,
                        chunks = Array.Empty<object>(),
                        alternatives = alternatives.Select(alt =>
                        {
                            var altDays = allDays.Where(p => p.Page >= alt.PageFrom && p.Page <= alt.PageTo).ToList();
                            if (drifting) altDays = Drift(altDays);
                            var chunks = altDays.GroupBy(d => d.Week).Select(g => new
                            {
                                label = $"Week {g.Key}", block = g.First().Block, phase = (string?)null, weekFrom = g.Key, weekTo = g.Key,
                                pageFrom = g.Min(d => d.Page), pageTo = g.Max(d => d.Page), dayCount = g.Count()
                            });
                            return new { id = alt.Id, name = alt.Name, chunks };
                        })
                    });
                }
                var outlineDays = drifting ? Drift(allDays) : allDays;
                var chunks = outlineDays.GroupBy(d => d.Week).Select(g => new
                {
                    label = $"Week {g.Key}", block = g.First().Block, phase = (string?)null, weekFrom = g.Key, weekTo = g.Key,
                    pageFrom = g.Min(d => d.Page), pageTo = g.Max(d => d.Page), dayCount = g.Count()
                });
                return JsonSerializer.Serialize(new { programTitle = (string?)null, chunks });
            }
            var days = allDays.Where(p => requested.Contains(p.Page)).ToList();
            if (drifting) days = Drift(days);
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

        private sealed record AlternativeRange(string Id, string Name, int PageFrom, int PageTo);

        private static List<AlternativeRange> DetectAlternatives(List<ImportPageText> allPages)
        {
            var tocPage = allPages.FirstOrDefault(p => p.Page <= 5 && Regex.IsMatch(p.Text, @"TABLE OF CONTENTS", RegexOptions.IgnoreCase));
            if (tocPage is not null)
            {
                var entries = new List<(string Name, int Page)>();
                foreach (var line in tocPage.Text.Split('\n'))
                {
                    var match = Regex.Match(line.Trim(), @"^(?<name>[A-Z/\s]+(?:PROGRAM|SPLIT))\s*\|\s*(?<page>\d+)\b", RegexOptions.IgnoreCase);
                    if (match.Success && int.TryParse(match.Groups["page"].Value, out var pageNum))
                    {
                        var name = match.Groups["name"].Value.Trim();
                        if (!name.Contains("EXPLAIN", StringComparison.OrdinalIgnoreCase)
                            && !name.Contains("VARIABLE", StringComparison.OrdinalIgnoreCase)
                            && !name.Contains("ABOUT", StringComparison.OrdinalIgnoreCase))
                            entries.Add((name, pageNum));
                    }
                }
                if (entries.Count >= 2)
                {
                    var explainPage = allPages.Where(p => Regex.IsMatch(p.Text, @"^PROGRAM EXPLAINED\b", RegexOptions.IgnoreCase))
                        .Select(p => p.Page).DefaultIfEmpty(allPages.Max(p => p.Page) + 1).Min();
                    var result = new List<AlternativeRange>();
                    for (var i = 0; i < entries.Count; i++)
                    {
                        var pFrom = entries[i].Page;
                        var pTo = (i + 1 < entries.Count ? entries[i + 1].Page : explainPage) - 1;
                        var rawName = entries[i].Name;
                        var title = CultureInfo.InvariantCulture.TextInfo.ToTitleCase(rawName.ToLowerInvariant());
                        var id = Regex.Replace(rawName.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
                        result.Add(new AlternativeRange(id, title, pFrom, pTo));
                    }
                    return result;
                }
            }
            return [];
        }

        private sealed record Day(int Week, string? Block, string? Name, bool Rest, int Page, List<object> Exercises);

        private static List<Day> Drift(List<Day> days)
        {
            var output = new List<Day>(days.Count);
            for (var index = 0; index < days.Count; index++)
            {
                var day = days[index];
                if (day.Rest) { output.Add(day); continue; }
                var key = day.Page * 7 + days.Take(index).Count(other => other.Page == day.Page);
                var exercises = day.Exercises.Select((exercise, position) => DriftExercise(exercise, key * 13 + position)).ToList();
                if (key % 6 == 0 && exercises.Count > 1) exercises.RemoveAt(exercises.Count - 1);
                if (key % 5 == 0)
                    exercises.Add(new
                    {
                        sequenceGroup = (string?)null, sourceName = "", exerciseId = (string?)null, warmupSets = (string?)null,
                        workingSets = (string?)null, substitutions = Array.Empty<string>(), coachingNotes = (string?)null,
                        notes = (string?)null, sourcePage = day.Page, sets = Array.Empty<object>()
                    });
                output.Add(day with { Exercises = exercises });
            }
            // The second rest day of every third week moves one slot earlier.
            foreach (var week in output.Select(day => day.Week).Distinct().Where(week => week % 3 == 0).ToList())
            {
                var rests = output.Select((day, index) => (day, index)).Where(item => item.day.Week == week && item.day.Rest).ToList();
                if (rests.Count < 2) continue;
                var at = rests[1].index;
                if (at == 0 || output[at - 1].Week != week || output[at - 1].Rest) continue;
                (output[at - 1], output[at]) = (output[at], output[at - 1]);
            }
            return output;
        }

        /// Exercises are anonymous objects, so a drifted one is rebuilt through its JSON form.
        private static object DriftExercise(object exercise, int key)
        {
            var node = JsonNode.Parse(JsonSerializer.Serialize(exercise))!.AsObject();
            if (key % 4 == 0 && node["sourceName"]?.GetValue<string>() is { Length: > 0 } name)
                node["sourceName"] = Regex.Replace(name.ToLowerInvariant(), @"(?<![\p{L}'])\p{L}", match => match.Value.ToUpperInvariant());
            if (key % 3 == 0 && node["sets"] is JsonArray sets)
                foreach (var set in sets.OfType<JsonObject>().Where(set => set["restText"] is not null))
                {
                    set["restText"] = "90 sec";
                    set["restSeconds"] = 90;
                }
            return node;
        }

        private static List<Day> Days(List<ImportPageText> selected)
        {
            var output = new List<Day>();
            var week = 1;
            string? block = null;
            int? lastPrinted = null;
            string? lastLetter = null;
            var offset = 0;
            foreach (var page in selected.OrderBy(p => p.Page))
            {
                // Exclude only a positively identified explanatory/appendix chapter. A week
                // number restarting by itself is not evidence that the pages are disposable.
                if (output.Count > 0 && (page.Text.Contains("TOTAL WEEKLY VOLUME OF PROGRAM")
                    || Regex.IsMatch(page.Text, @"^(?:PROGRAM EXPLAINED|WEEKLY VOLUMES?)\b", RegexOptions.IgnoreCase)))
                {
                    break;
                }

                string? name = null;
                string? currentLabel = null;
                string? sectionHeading = null;
                bool isRestTable = false;
                Dictionary<string, int>? columns = null;
                var exercises = new List<object>();
                void Flush()
                {
                    if (isRestTable)
                    {
                        output.Add(new Day(week, block, "Rest Day", true, page.Page, []));
                        isRestTable = false;
                    }
                    else if (exercises.Count > 0)
                    {
                        var sessionName = name ?? currentLabel;
                        if (output.Any(d => d.Page == page.Page && !d.Rest && string.Equals(d.Name, sessionName, StringComparison.OrdinalIgnoreCase)))
                        {
                            sessionName = $"{sessionName} (Part {output.Count(d => d.Page == page.Page && !d.Rest) + 1})";
                        }
                        output.Add(new Day(week, block, sessionName, false, page.Page, exercises));
                    }
                    exercises = [];
                }
                foreach (var raw in page.Text.Split('\n'))
                {
                    var line = raw.Trim();
                    if (Regex.Match(line, @"(?:^|[/|:]\s*|PROGRAM:\s*)WEEK\s+(\d{1,2})(?:(?<letter>[A-Z])|\s*:\s*OPTION\s+(?<opt>[A-Z]))?", RegexOptions.IgnoreCase) is { Success: true } w)
                    {
                        var parsedWeek = int.Parse(w.Groups[1].Value);
                        var letter = w.Groups["letter"].Success ? w.Groups["letter"].Value : (w.Groups["opt"].Success ? w.Groups["opt"].Value : null);
                        if (lastPrinted is not null && parsedWeek == lastPrinted && letter is not null && lastLetter is not null && !string.Equals(letter, lastLetter, StringComparison.OrdinalIgnoreCase))
                        {
                            offset++;
                        }
                        week = offset + parsedWeek;
                        lastPrinted = parsedWeek;
                        if (letter is not null) lastLetter = letter;
                    }
                    if (line.Length < 70 && Regex.Match(line, @"^BLOCK\s+(\d+)", RegexOptions.IgnoreCase) is { Success: true } b) block = $"Block {b.Groups[1].Value}";
                    if (line.StartsWith("DAY LABEL: "))
                    {
                        Flush();
                        currentLabel = line["DAY LABEL: ".Length..].Trim();
                        name = currentLabel;
                        sectionHeading = null;
                        isRestTable = false;
                        continue;
                    }
                    if (Regex.IsMatch(line, @"^(?:STRENGTH FOCUS|HYPERTROPHY FOCUS|SUPPLEMENTAL(?:\s+[A-Z])?)$", RegexOptions.IgnoreCase))
                    {
                        sectionHeading = line;
                        continue;
                    }
                    if (Regex.IsMatch(line, @"^(?:\d(?:\s*[-–]\s*\d)?\s+)?(?:Optional |Mandatory |Suggested )?Rest Days?$", RegexOptions.IgnoreCase))
                    {
                        Flush();
                        output.Add(new Day(week, block, "Rest Day", true, page.Page, []));
                        continue;
                    }
                    var cells = line.Split('|').Select(c => c.Trim()).ToArray();
                    var lower = cells.Select(c => c.ToLowerInvariant()).ToArray();
                    if (lower.Any(c => Regex.IsMatch(c, @"^(?:working\s+)?sets?$|^# of working sets$")) && lower.Any(c => c.StartsWith("rep")))
                    {
                        if (exercises.Count > 0 || isRestTable) Flush();
                        columns = lower.Select((c, i) => (c, i)).GroupBy(x => x.c).ToDictionary(g => g.Key, g => g.First().i);
                        if (!lower.Any(c => c is "exercise" or "exercises" or "movement")) columns["exercise"] = 0;
                        if (lower[0] == "rest")
                        {
                            isRestTable = true;
                        }
                        else if (!lower[0].Contains("exercise") && !lower[0].Contains("movement") && cells[0].Length > 0)
                        {
                            name = sectionHeading is not null
                                ? $"{cells[0]} ({sectionHeading})"
                                : (currentLabel is not null && !string.Equals(currentLabel, cells[0], StringComparison.OrdinalIgnoreCase)
                                    ? $"{currentLabel} - {cells[0]}"
                                    : cells[0]);
                        }
                        else
                        {
                            name = currentLabel;
                        }
                        continue;
                    }
                    if (columns is null || cells.Length < 4) continue;
                    var c0 = cells[0].Trim();
                    if (Regex.IsMatch(c0, @"^(?:lower|upper|full body|leg|push|pull|day)\s*#?\s*\d+", RegexOptions.IgnoreCase))
                    {
                        name = c0;
                    }
                    string? Cell(Func<string, bool> pick) => columns.Where(c => pick(c.Key)).Select(c => c.Value).Where(i => i < cells.Length)
                        .Select(i => cells[i]).FirstOrDefault(v => v.Length > 0);
                    var written = Cell(k => k is "exercise" or "exercises" or "movement") ?? "";
                    written = Regex.Replace(written, @"\s+(?:\d+\s+)?(?:WEEKLY|SESSION|TOTAL)\s+.*VOLUME.*$", "", RegexOptions.IgnoreCase).Trim();
                    if (!Regex.IsMatch(written, "[A-Za-z]") || Regex.IsMatch(written, @"^(?:TOTAL|SESSION|WEEKLY)\b", RegexOptions.IgnoreCase)
                        || Regex.IsMatch(written, @"^(?:N/?A|REST|NO PHYSICAL ACTIVITY)$", RegexOptions.IgnoreCase)) continue;
                    // Like the model, a superset tag ("A1:", "Superset A1:") leaves the name for sequenceGroup.
                    var group = Regex.Match(written, @"^(?:(?:super|tri|giant|compound)[\s-]?sets?\s*|circuit\s*)?([A-Z]\d+)[:.]\s*", RegexOptions.IgnoreCase);
                    var sourceName = group.Success ? written[group.Length..] : written;
                    var setsText = Cell(k => k.Contains("working") || Regex.IsMatch(k, @"^sets?$"));
                    var count = int.TryParse(Regex.Match(setsText ?? "", @"\d+").Value, out var n) && n > 0 ? Math.Min(n, 10) : 1;
                    if (Regex.Match(sourceName, @"^(?<base>.*\))\s+(?<count>\d{1,2})$") is { Success: true } fused)
                    {
                        sourceName = fused.Groups["base"].Value.Trim();
                        count = int.Parse(fused.Groups["count"].Value);
                    }
                    var reps = Cell(k => k.StartsWith("rep")) ?? "";
                    var repMatch = Regex.Match(reps, @"(\d+)(?:\s*[-–]\s*(\d+))?");
                    var (min, max) = repMatch.Success ? (int.Parse(repMatch.Groups[1].Value), int.Parse(repMatch.Groups[2].Success ? repMatch.Groups[2].Value : repMatch.Groups[1].Value)) : (0, 0);
                    var rpeText = Cell(k => (k.Contains("rpe") && !k.Contains("lsrpe")) || k == "ape");
                    double? rpe = null;
                    if (rpeText is not null && !Regex.IsMatch(rpeText, @"^NOTES?$", RegexOptions.IgnoreCase))
                    {
                        var range = Regex.Match(rpeText, @"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)");
                        if (range.Success && double.TryParse(range.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var r1)
                            && double.TryParse(range.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var r2))
                        {
                            rpe = r1 >= 5 && r2 >= 5 ? Math.Round((r1 + r2) / 2) : r1 < 5 && r2 is >= 6 and <= 10 ? r2 : null;
                        }
                        else if (double.TryParse(Regex.Match(rpeText, @"\d+(?:\.\d+)?").Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var r) && r is >= 6 and <= 10)
                        {
                            rpe = r;
                        }
                    }
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
