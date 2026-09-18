namespace Workout.Api.Services;

/// How a written exercise name finds the library entry it means.
///
/// A program writes movements the way a coach says them, and the library stores one canonical name
/// each: "Pull-Up (Wide Grip)" is a pull-up, "DB Incline Press" is a dumbbell incline press, "Lat
/// Pulldown (Wide Grip)" is a lat pulldown. Exact spelling was the only thing that matched, so a
/// real program arrived with almost every name unlinked and every one of them had to be mapped by
/// hand in review.
///
/// The steps below are ordered by how much they assume, and stop at the first hit. Each is a
/// rewriting of how the same movement is written down — an abbreviation, a grip noted in brackets,
/// a plural — never a judgement that two movements are close enough. A name this cannot place
/// stays unresolved and keeps its wording, because an unlinked name a reviewer can map is worth
/// more than a confident wrong one they will not notice.
internal static class CatalogMatching
{
    /// Equipment as a table writes it against equipment as the library names it.
    private static readonly Dictionary<string, string> Abbreviations = new(StringComparer.Ordinal)
    {
        ["db"] = "dumbbell", ["dbs"] = "dumbbell", ["bb"] = "barbell", ["kb"] = "kettlebell",
        ["ez"] = "ez bar", ["sm"] = "smith machine", ["bw"] = "bodyweight", ["cbl"] = "cable",
        ["ohp"] = "overhead press", ["rdl"] = "romanian deadlift", ["sldl"] = "stiff leg deadlift",
        ["gm"] = "good morning", ["bor"] = "bent over row", ["dl"] = "deadlift"
    };

    /// The library entry a written name means, or none. Steps are tried in order of how much they
    /// assume and stop at the first hit; the tail of a name is considered only once nothing spells
    /// the whole of it.
    public static Guid? Find(Dictionary<string, Guid> library, string name)
    {
        if (CatalogService.Normalize(name).Length == 0) return null;
        foreach (var variant in Variants(name))
            if (library.TryGetValue(variant, out var id)) return id;
        foreach (var tail in HeadVariants(name))
            if (library.TryGetValue(tail, out var id)) return id;
        return null;
    }

    /// One name as several equally faithful spellings of itself, most literal first. Every one is
    /// looked up exactly, so a variant only ever finds an entry that genuinely carries that name.
    public static IEnumerable<string> Variants(string name)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in Spellings(name))
            if (candidate.Length > 0 && seen.Add(candidate))
                yield return candidate;
    }

    private static IEnumerable<string> Spellings(string name)
    {
        var plain = CatalogService.Normalize(name);
        yield return plain;
        yield return Expand(plain);

        // A bracketed qualifier is how a table notes a grip, a stance or a tempo on a movement the
        // library holds under its plain name: "Pull-Up (Wide Grip)" is stored as "Pull Up".
        var unbracketed = CatalogService.Normalize(RemoveBracketed(name));
        yield return unbracketed;
        yield return Expand(unbracketed);

        yield return Singular(plain);
        yield return Singular(Expand(plain));
        yield return Singular(unbracketed);
        yield return Singular(Expand(unbracketed));
    }

    /// The tail of a written name, for a library entry the name ends with: "Smith Machine Incline
    /// Press" ends with "Incline Press". Only a tail of two words or more is offered, because a
    /// single trailing word is the movement's family rather than the movement — matching "Squat"
    /// from "Front Squat" would name a different exercise.
    public static IEnumerable<string> HeadVariants(string name)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var spelling in new[] { CatalogService.Normalize(RemoveBracketed(name)), Expand(CatalogService.Normalize(RemoveBracketed(name))) })
        {
            var words = spelling.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            for (var start = 1; start <= words.Length - 2; start++)
            {
                var tail = string.Join(' ', words.Skip(start));
                if (seen.Add(tail)) yield return tail;
            }
        }
    }

    private static string RemoveBracketed(string name)
    {
        var builder = new System.Text.StringBuilder(name.Length);
        var depth = 0;
        foreach (var character in name)
        {
            if (character is '(' or '[') { depth++; continue; }
            if (character is ')' or ']') { depth = Math.Max(0, depth - 1); continue; }
            if (depth == 0) builder.Append(character);
        }
        return builder.ToString();
    }

    private static string Expand(string normalized)
        => string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => Abbreviations.TryGetValue(word, out var full) ? full : word));

    /// The same words written singly. A table says "Curls" where the library says "Curl".
    private static string Singular(string normalized)
        => string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Length > 3 && word.EndsWith('s') && !word.EndsWith("ss") ? word[..^1] : word));
}
