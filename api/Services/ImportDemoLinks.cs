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
        return new UriBuilder(uri) { Scheme = Uri.UriSchemeHttps, Port = -1 }.Uri.ToString();
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
        foreach (var link in links)
        {
            var name = Regex.Replace(link.Name, @"^\s*[A-Z]\d+\s*:\s*", "", RegexOptions.IgnoreCase);
            name = Regex.Replace(name, @"\s*\(\s*(?:HEAVY|BACK[- ]?OFF)\s*\)\s*$", "", RegexOptions.IgnoreCase);
            var key = Key(name);
            if (key.Length == 0 || key == Key(link.Name)) continue;
            Record(fallback, key, link.Url);
            Record(pageFallback, (link.Page, key), link.Url);
        }

        static void Record<TKey>(Dictionary<TKey, string?> map, TKey key, string url) where TKey : notnull
        {
            if (map.TryGetValue(key, out var prior) && prior != url) map[key] = null;
            else if (!map.ContainsKey(key)) map[key] = url;
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
                        var link = Find(sourcePage, key, byPage, byName)
                            ?? Find(sourcePage, key, pageFallback, fallback);
                        if (link is not null) available[key] = link;
                    }
                    var current = ForName(available, exercise.SourceName);
                    return exercise with { DemoUrl = current, DemoLinks = available };
                }).ToList()
            }).ToList()
        };
    }

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
