using System.Text.RegularExpressions;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Checks the demonstration links an exercise carries. A URL is never trusted from the client: it is
/// a place the app will later offer to send someone, so only an https link to an approved
/// demonstration or exercise guide is accepted.
internal static class ImportDemoLinks
{
    public const int MaxNameChars = 120;
    public const int MaxUrlChars = 400;

    private static readonly HashSet<string> VideoHosts = new(StringComparer.OrdinalIgnoreCase)
        { "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be",
          "exrx.net", "www.exrx.net", "roguefitness.com", "www.roguefitness.com" };
    public static IReadOnlyCollection<string> ApprovedHosts => VideoHosts;

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
