using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// A demonstration video the document links from one of its exercise names. Recent programs carry
/// these as a PDF annotation layer rather than as text, so the browser reads them from the
/// annotations and submits the name/URL pairs; the document itself still never leaves the device.
public record ImportPageLink(int Page, string Name, string Url);

/// Accepts the links a browser submits and attaches them to the exercises they name.
///
/// The URL is checked again here rather than trusted from the client: it originates in an
/// untrusted document, and it is a place the app will later offer to send someone. Anything that
/// is not an https link to an approved demonstration or exercise guide is dropped rather than
/// refused — a bad link in the PDF is no reason to fail a faithful read of the schedule.
internal static class ImportDemoLinks
{
    public const int MaxLinks = 4000;
    public const int MaxNameChars = 120;
    public const int MaxUrlChars = 400;

    private static readonly HashSet<string> VideoHosts = new(StringComparer.OrdinalIgnoreCase)
        { "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be",
          "exrx.net", "www.exrx.net", "roguefitness.com", "www.roguefitness.com" };

    public static List<ImportPageLink> Normalize(IEnumerable<ImportPageLink>? links, int pageCount)
    {
        var output = new List<ImportPageLink>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var link in links ?? [])
        {
            if (link is null || link.Page <= 0 || link.Page > pageCount) continue;
            var name = ImportNormalization.Text(link.Name, MaxNameChars);
            var url = Video(link.Url);
            if (name is null || url is null) continue;
            if (!seen.Add($"{Key(name)}{url}")) continue;
            output.Add(new ImportPageLink(link.Page, name, url));
            if (output.Count >= MaxLinks) break;
        }
        return output;
    }

    /// Returns the URL only when it is one this app is willing to open, upgraded to https.
    public static string? Video(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > MaxUrlChars) return null;
        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return null;
        if (!VideoHosts.Contains(uri.Host)) return null;
        // A channel or search page on a video host is not a demonstration of anything.
        if (uri.Host.Contains("youtu", StringComparison.OrdinalIgnoreCase) && !IsYouTubeVideo(uri)) return null;
        return new UriBuilder(uri) { Scheme = Uri.UriSchemeHttps, Port = -1, Query = WithoutShareToken(uri) }.Uri.ToString();
    }

    private static bool IsYouTubeVideo(Uri uri)
    {
        if (uri.Host.EndsWith("youtu.be", StringComparison.OrdinalIgnoreCase))
            return Regex.IsMatch(uri.AbsolutePath, @"^/[\w-]+/?$");
        if (uri.AbsolutePath == "/watch")
            return Regex.IsMatch(uri.Query, @"(?:^\?|&)v=[\w-]+(?:&|$)");
        return Regex.IsMatch(uri.AbsolutePath, @"^/(?:shorts|embed|live|v)/[\w-]+/?$");
    }

    /// YouTube's share button appends a per-share "si" token, so one video printed on two pages
    /// can carry two addresses. Dropping it lets the same demonstration compare equal to itself.
    private static string WithoutShareToken(Uri uri)
    {
        if (!uri.Host.Contains("youtu", StringComparison.OrdinalIgnoreCase) || uri.Query.Length == 0)
            return uri.Query;
        var kept = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(part => !part.StartsWith("si=", StringComparison.OrdinalIgnoreCase));
        return string.Join('&', kept);
    }

    /// A cited page wins when the same printed movement carries different demonstrations. A
    /// document-wide name match is used only when it points to one unambiguous URL.
    public static ImportDraft Attach(ImportDraft draft, IReadOnlyList<ImportPageLink> links)
    {
        if (links.Count == 0) return draft;
        var byName = new Dictionary<string, string?>(StringComparer.Ordinal);
        var byPage = new Dictionary<(int Page, string Name), string?>();
        foreach (var link in links)
        {
            var key = Key(link.Name);
            if (key.Length == 0) continue;
            Record(byName, key, link.Url);
            Record(byPage, (link.Page, key), link.Url);
        }
        if (byName.Count == 0) return draft;

        // Only a printed set qualifier or superset prefix may be removed. If two linked rows then
        // claim different videos for the same movement, leave the fallback unset rather than guess.
        var fallback = new Dictionary<string, string?>(StringComparer.Ordinal);
        var pageFallback = new Dictionary<(int Page, string Name), string?>();
        var pageTitles = DayTitlesByPage(draft);
        // The same words in another order: a library spelling of a printed alternative
        // ("Incline Smith Machine Press" for "Smith Machine Incline Press") still names its link.
        var byWords = new Dictionary<string, string?>(StringComparer.Ordinal);
        var pageWords = new Dictionary<(int Page, string Name), string?>();
        foreach (var link in links)
        {
            var key = Key(Unqualified(link.Name));
            var fullKey = Key(link.Name);
            if (key.Length > 0)
            {
                Record(byWords, WordSet(key), link.Url);
                Record(pageWords, (link.Page, WordSet(key)), link.Url);
            }
            if (key.Length > 0 && key != fullKey)
            {
                Record(fallback, key, link.Url);
                Record(pageFallback, (link.Page, key), link.Url);
            }
            // A rotated day title on the page's spine can land inside the link's rectangle, so its
            // text reads "Hammer Preacher Pull #1 (Lat Focused) Curl". Only a title printed on
            // that same page is taken out, and only where it appears as whole words.
            foreach (var title in pageTitles.GetValueOrDefault(link.Page) ?? [])
            {
                var untitled = WithoutWords(key.Length > 0 ? key : fullKey, title);
                if (untitled.Length < 3 || untitled == key || untitled == fullKey) continue;
                Record(fallback, untitled, link.Url);
                Record(pageFallback, (link.Page, untitled), link.Url);
            }
        }

        static void Record<TKey>(Dictionary<TKey, string?> map, TKey key, string url) where TKey : notnull
        {
            // The first address wins among ones that play the same thing: the browser submits the
            // annotation before the printed copy, which a wrap may have cut short.
            if (map.TryGetValue(key, out var prior)) { if (prior is not null && Plays(prior) != Plays(url)) map[key] = null; }
            else map[key] = url;
        }

        string? Find(int? page, string key, Dictionary<(int Page, string Name), string?> pageLinks,
            Dictionary<string, string?> documentLinks)
        {
            if (page is { } sourcePage && pageLinks.TryGetValue((sourcePage, key), out var local)) return local;
            return documentLinks.GetValueOrDefault(key);
        }

        return draft with
        {
            Workouts = draft.Workouts.Select(workout => workout with
            {
                Exercises = workout.Exercises.Select(exercise =>
                {
                    var names = new[] { exercise.SourceName }.Concat(exercise.Substitutions ?? []);
                    var available = new Dictionary<string, string>(StringComparer.Ordinal);
                    var sourcePage = exercise.SourcePage ?? workout.SourcePage;
                    foreach (var name in names)
                    {
                        var key = Key(name);
                        var plainKey = Key(Unqualified(name));
                        var link = Find(sourcePage, key, byPage, byName)
                            ?? Find(sourcePage, key, pageFallback, fallback)
                            ?? (plainKey.Length > 0 && plainKey != key
                                ? Find(sourcePage, plainKey, byPage, byName) ?? Find(sourcePage, plainKey, pageFallback, fallback)
                                : null)
                            ?? (plainKey.Length > 0 ? Find(sourcePage, WordSet(plainKey), pageWords, byWords) : null);
                        if (link is not null) available[key] = link;
                    }
                    var current = ForName(available, exercise.SourceName);
                    return exercise with { DemoUrl = current, DemoLinks = available };
                }).ToList()
            }).ToList()
        };
    }

    /// The movement without what a table prints around it: a superset tag ("A1:"), a role tag
    /// ("[TOPSET]", "[BACK OFF]") or a trailing set qualifier ("(Heavy)", "(Optional)").
    private static string Unqualified(string name)
    {
        var plain = ImportSetTags.Strip(name);
        plain = Regex.Replace(plain, @"^\s*\[[^\]]{1,24}\]\s*", "");
        plain = Regex.Replace(plain, @"\s*\(\s*(?:HEAVY|BACK[- ]?OFF|TOP[- ]?SET|OPTIONAL)\s*\)\s*$", "", RegexOptions.IgnoreCase);
        return plain.Trim();
    }

    private static Dictionary<int, List<string>> DayTitlesByPage(ImportDraft draft)
    {
        var titles = new Dictionary<int, List<string>>();
        foreach (var workout in draft.Workouts.Where(workout => !workout.IsRestDay))
        {
            var pages = workout.Exercises.Select(exercise => exercise.SourcePage).Append(workout.SourcePage)
                .OfType<int>().Distinct();
            var keys = new[] { workout.Name, workout.Focus }.Select(Key)
                // A one-word title ("Chest", "Legs") is also a word of real exercise names.
                .Where(key => key.Contains(' ')).ToList();
            foreach (var page in pages)
            {
                if (!titles.TryGetValue(page, out var list)) titles[page] = list = [];
                list.AddRange(keys.Where(key => !list.Contains(key)));
            }
        }
        return titles;
    }

    /// What a link plays: a YouTube video and its start time, whatever feature or share parameters
    /// ride along; any other address is itself.
    private static string Plays(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !uri.Host.Contains("youtu", StringComparison.OrdinalIgnoreCase))
            return url;
        var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2)).Where(pair => pair.Length == 2)
            .GroupBy(pair => pair[0], StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.First()[1], StringComparer.OrdinalIgnoreCase);
        var id = uri.Host.EndsWith("youtu.be", StringComparison.OrdinalIgnoreCase)
            ? uri.AbsolutePath.Trim('/')
            : query.GetValueOrDefault("v") ?? uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).ElementAtOrDefault(1) ?? "";
        return $"youtube:{id}@{query.GetValueOrDefault("t")?.TrimEnd('s')}";
    }

    private static string WordSet(string key)
        => string.Join(' ', key.Split(' ', StringSplitOptions.RemoveEmptyEntries).Order(StringComparer.Ordinal));

    private static string WithoutWords(string key, string words)
        => Regex.Replace($" {key} ".Replace($" {words} ", " ", StringComparison.Ordinal), @"\s+", " ").Trim();

    /// The same spelling both sides, so "DB Flye" in the annotation reaches "Dumbbell Flye" in the
    /// read and neither casing nor punctuation loses a link.
    public static string? ForName(IReadOnlyDictionary<string, string>? links, string? name)
        => links is not null && links.TryGetValue(Key(name), out var url) ? Video(url) : null;

    public static Dictionary<string, string> NormalizeMap(IReadOnlyDictionary<string, string>? links)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, rawUrl) in links ?? new Dictionary<string, string>())
        {
            var key = Key(name);
            var url = Video(rawUrl);
            if (key.Length == 0 || key.Length > MaxNameChars || url is null) continue;
            result.TryAdd(key, url);
            if (result.Count >= 4) break;
        }
        return result;
    }

    public static string Key(string? value)
        => CatalogMatching.Expand(CatalogService.Normalize(value ?? ""));
}
