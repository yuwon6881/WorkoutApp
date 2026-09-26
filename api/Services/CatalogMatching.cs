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

    /// A table sometimes puts the set method in the exercise column even though it is a
    /// prescription, not a different movement. These are deliberately complete phrases rather
    /// than loose words: "weighted" must not disappear from "Weighted Pull-Up", while the
    /// document's "Weighted Static Hold" should leave "Machine Chest Press" behind.
    private static readonly string[] TechniquePhrases =
    [
        "lengthened partials", "lengthened partial", "long length partials", "long length partial",
        "two drop sets", "drop sets", "drop set", "dropset",
        "weighted static hold", "static hold", "extend set",
        "myo reps", "myo rep", "myoreps",
        "integrated partials", "integrated partial",
        "reverse 21s", "reverse 21 s", "21s", "21 s",
        "full rom"
    ];

    /// The library entry a written name means, or none. Steps are tried in order of how much they
    /// assume and stop at the first hit; the tail of a name is considered only once nothing spells
    /// the whole of it.
    public static Guid? Find(Dictionary<string, Guid> library, string name) => Find(library, name, allowTail: true);

    /// A library entry that spells the whole written name, never one it merely ends with. A
    /// printed alternative is renamed only to this, because its wording is otherwise lost:
    /// "Seated Smith Machine Shoulder Press" ends with, but is not, "Machine Shoulder Press".
    public static Guid? FindWhole(Dictionary<string, Guid> library, string name) => Find(library, name, allowTail: false);

    private static Guid? Find(Dictionary<string, Guid> library, string name, bool allowTail)
    {
        var norm = CatalogService.Normalize(name);
        if (norm.Length == 0) return null;
        // "Your Choice" and option selectors explicitly mean the document leaves the movement to the person.
        // Even if a generic "Squat" happens to be in a tenant's library, selecting it would erase that
        // choice and could change the prescribed movement.
        if (norm.Contains("your choice", StringComparison.Ordinal) ||
            norm.Contains("weak point", StringComparison.Ordinal) ||
            norm.Contains("pick one", StringComparison.Ordinal) ||
            norm.Contains("choose one", StringComparison.Ordinal)) return null;
        foreach (var variant in Variants(name))
            if (library.TryGetValue(variant, out var id)) return id;
        if (allowTail)
            foreach (var tail in HeadVariants(name))
                if (library.TryGetValue(tail, out var id)) return id;
        // The same words in another order, or spelled another way ("Bent Over Barbell Row" is
        // "Barbell Bent-Over Row"; "Tricep" is "Triceps"). Still a spelling of one name.
        foreach (var variant in Variants(name))
            if (library.TryGetValue(WordSetKey(variant), out var id)) return id;
        return null;
    }

    /// Words a table spells differently from the library, each mapped to the library's spelling.
    private static readonly Dictionary<string, string> WordSpellings = new(StringComparer.Ordinal)
    {
        ["tricep"] = "triceps", ["bicep"] = "biceps", ["medicine"] = "med", ["dumbell"] = "dumbbell",
        ["fly"] = "flye", ["flys"] = "flye", ["flies"] = "flye", ["flyes"] = "flye"
    };

    /// A name as its set of words, order-free and in the library's spelling. Prefixed so it can
    /// never collide with a literal name key.
    internal static string WordSetKey(string normalized)
    {
        var words = Singular(Expand(normalized)).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => WordSpellings.TryGetValue(word, out var spelled) ? spelled : word)
            .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        return words.Count < 2 ? "" : "~" + string.Join(' ', words);
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

        // Preserve the movement's meaningful qualifiers (close-grip, machine, dumbbell, incline)
        // while removing only the table's set technique. This is tried after the literal spelling
        // so a catalog entry that intentionally includes a technique still wins first.
        var withoutTechnique = RemoveTechnique(plain);
        yield return withoutTechnique;
        yield return Expand(withoutTechnique);

        // A bracketed qualifier is how a table notes a grip, a stance or a tempo on a movement the
        // library holds under its plain name: "Pull-Up (Wide Grip)" is stored as "Pull Up".
        var unbracketed = CatalogService.Normalize(RemoveBracketed(name));
        yield return unbracketed;
        yield return Expand(unbracketed);

        var unbracketedWithoutTechnique = RemoveTechnique(unbracketed);
        yield return unbracketedWithoutTechnique;
        yield return Expand(unbracketedWithoutTechnique);

        yield return Singular(plain);
        yield return Singular(Expand(plain));
        yield return Singular(withoutTechnique);
        yield return Singular(Expand(withoutTechnique));
        yield return Singular(unbracketed);
        yield return Singular(Expand(unbracketed));
        yield return Singular(unbracketedWithoutTechnique);
        yield return Singular(Expand(unbracketedWithoutTechnique));

        // A trailing "Machine" restates the equipment of a movement the library names without it:
        // "Seated Hip Abduction Machine" is "Seated Hip Abduction".
        var words = unbracketedWithoutTechnique.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length >= 3 && words[^1] == "machine")
        {
            var withoutMachine = string.Join(' ', words[..^1]);
            yield return withoutMachine;
            yield return Singular(Expand(withoutMachine));
        }
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

    /// Exposed so source-grounding can settle a written name and the page text it came from on
    /// one spelling: a document that prints "DB Flye" and a read that returns "Dumbbell Flye"
    /// describe the same printed row.
    internal static string Expand(string normalized)
        => string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => Abbreviations.TryGetValue(word, out var full) ? full : word));

    private static string RemoveTechnique(string normalized)
    {
        var output = normalized;
        foreach (var phrase in TechniquePhrases)
            output = output.Replace(phrase, " ", StringComparison.Ordinal);
        return string.Join(' ', output.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// The spellings a library name is also filed under: abbreviations written out, and plurals
    /// written singly ("Cable Triceps Kickback" is what "Cable Tricep Kickback" means).
    internal static IEnumerable<string> LibraryKeys(string normalized)
    {
        var expanded = Expand(normalized);
        return new[] { expanded, Singular(normalized), Singular(expanded), WordSetKey(normalized) }
            .Where(key => key.Length > 0 && key != normalized).Distinct();
    }

    /// The same words written singly. A table says "Curls" where the library says "Curl".
    private static string Singular(string normalized)
        => string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Length > 3 && word.EndsWith('s') && !word.EndsWith("ss") ? word[..^1] : word));
}
