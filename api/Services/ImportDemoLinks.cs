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
/// is not an https video link is dropped rather than refused — a bad link in the annotation layer
/// is no reason to fail a faithful read of the schedule.
internal static class ImportDemoLinks
{
    public const int MaxLinks = 4000;
    public const int MaxNameChars = 120;
    public const int MaxUrlChars = 400;

    private static readonly HashSet<string> VideoHosts = new(StringComparer.OrdinalIgnoreCase)
        { "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be" };

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

    /// Attaches each link to the exercises that carry its name. The name is the whole key: one
    /// movement has one demonstration wherever the document repeats it, so matching on the name
    /// rather than the page keeps every week's copy linked even when a section misreports a page.
    public static ImportDraft Attach(ImportDraft draft, IReadOnlyList<ImportPageLink> links)
    {
        if (links.Count == 0) return draft;
        var byName = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var link in links)
        {
            var key = Key(link.Name);
            if (key.Length > 0) byName.TryAdd(key, link.Url);
        }
        if (byName.Count == 0) return draft;

        return draft with
        {
            Workouts = draft.Workouts.Select(workout => workout with
            {
                Exercises = workout.Exercises.Select(exercise =>
                {
                    var names = new[] { exercise.SourceName }.Concat(exercise.Substitutions ?? []);
                    var available = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (var name in names)
                        if (byName.TryGetValue(Key(name), out var link)) available[Key(name)] = link;
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
