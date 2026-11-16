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
        => FindLink(library, name, allowTail)?.Id;

    /// A match together with what it set aside. A match that discards words the written name carried
    /// ("Smith Machine Incline Press" settled on "Incline Press", "Row (Dumbbell)" on "Row") is useful
    /// but not certain, so the import review flags it instead of presenting it as a spelling of the name.
    internal sealed record Link(Guid Id, string? Dropped);

    /// Stored in the index for a derived spelling two exercises share. A lookup that lands on it ends the
    /// search unresolved: continuing to a shorter name would pick a generic exercise over the specific
    /// ones the written name could mean.
    internal static readonly Guid Ambiguous = Guid.Empty;

    private static Link? Resolve(Guid id, string? dropped) => id == Ambiguous ? null : new Link(id, dropped);

    /// A library entry that spells the whole written name with nothing set aside, not even a bracketed
    /// qualifier. For choices applied without a second look.
    public static Guid? FindUnaltered(Dictionary<string, Guid> library, string name)
        => FindLink(library, name, allowTail: false) is { Dropped: null } link ? link.Id : null;

    public static Link? FindWithDropped(Dictionary<string, Guid> library, string name) => FindLink(library, name, allowTail: true);

    /// Bracketed words that prescribe how a set is done, never which movement it is. Grip, stance and
    /// handle words are deliberately absent: a wide grip or a sumo stance can be a different exercise, so
    /// setting one aside is flagged unless the matched name (or an alias of it) carries the word.
    private static readonly HashSet<string> TechniqueNoteWords = new(StringComparer.Ordinal)
    {
        "tempo", "pause", "paused", "rom", "per", "side", "each", "reps", "sets",
        "extend", "set", "drop", "myo", "partials", "partial", "lengthened", "optional",
        // Prescription and purpose labels, and the muscle a table names beside a movement that already trains it.
        "rpe", "amrap", "back", "off", "work", "abs", "traps", "glutes", "quads", "hamstrings", "calves",
        "chest", "biceps", "triceps", "shoulders", "lats", "delts", "forearms"
    };

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

    /// Leading words the import already carries through another route: "Pause" becomes pause sets on the
    /// linked movement, so setting it aside from the name loses nothing.
    private static string WithoutHandledWords(string dropped)
        => string.Join(' ', dropped.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(word => word is not ("pause" or "paused")));

    /// The meaningful words of a bracketed note the matched spelling does not carry.
    private static string? DroppedBracket(string name, string matched)
    {
        var noted = new System.Text.StringBuilder();
        var depth = 0;
        foreach (var character in name)
        {
            if (character is '(' or '[') { depth++; noted.Append(' '); continue; }
            if (character is ')' or ']') { depth = Math.Max(0, depth - 1); noted.Append(' '); continue; }
            if (depth > 0) noted.Append(character);
        }
        var carried = Expand(matched).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => Singular(word)).ToHashSet(StringComparer.Ordinal);
        var lost = Expand(CatalogService.Normalize(noted.ToString()).Replace("grip work", " ", StringComparison.Ordinal)).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(word => !word.All(char.IsDigit) && !TechniqueNoteWords.Contains(word) && !carried.Contains(Singular(word)))
            .ToList();
        // A trailing "Machine" is also set aside by the spelling rules ("Seated Row Machine" as "Seated
        // Row"). It names the equipment, so the link is reported rather than presented as the same name.
        var written = CatalogService.Normalize(RemoveBracketed(name)).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (written.Length >= 3 && written[^1] == "machine" && !carried.Contains("machine")) lost.Add("machine");
        return lost.Count == 0 ? null : string.Join(' ', lost);
    }

    private static Link? FindLink(Dictionary<string, Guid> library, string name, bool allowTail)
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
        // An exact full name comes first, followed by the same complete words in another order.
        // Do this before removing bracketed qualifiers or techniques from the written name.
        if (library.TryGetValue(norm, out var exact)) return Resolve(exact, null);
        // An expansion is not the written name: if the same words are claimed by more than one entry,
        // "DBs Row" must not settle on whichever of "DB Row" and "Dumbbell Row" its expansion spells.
        if (library.TryGetValue(WordSetKey(norm), out var claimed) && claimed == Ambiguous) return null;
        if (library.TryGetValue(Expand(norm), out var expanded)) return Resolve(expanded, null);
        if (library.TryGetValue(WordSetKey(norm), out var wholeWords)) return Resolve(wholeWords, null);
        if (library.TryGetValue("=" + norm.Replace(" ", "", StringComparison.Ordinal), out var wholeJoined)) return Resolve(wholeJoined, null);
        foreach (var variant in Variants(name))
            if (library.TryGetValue(variant, out var id)) return Resolve(id, DroppedBracket(name, variant));
        // The same words in another order, or spelled another way ("Bent Over Barbell Row" is
        // "Barbell Bent-Over Row"; "Tricep" is "Triceps"). Still a spelling of one name.
        foreach (var variant in Variants(name))
            if (library.TryGetValue(WordSetKey(variant), out var id)) return Resolve(id, DroppedBracket(name, variant));
        // A document whose text layer lost its spaces ("WIDEGRIPLATPULLDOWN") still spells one name letter for letter.
        foreach (var variant in Variants(name))
            if (library.TryGetValue("=" + variant.Replace(" ", "", StringComparison.Ordinal), out var id)) return Resolve(id, DroppedBracket(name, variant));
        // Only discard leading words after every whole-name spelling has been considered.
        if (allowTail)
            foreach (var (tail, dropped) in HeadTails(name))
                if (library.TryGetValue(tail, out var id))
                    return Resolve(id, NullIfEmpty(string.Join(" ", new[] { WithoutHandledWords(dropped), DroppedBracket(name, tail) }.Where(part => part is { Length: > 0 }))));
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
    public static IEnumerable<string> HeadVariants(string name) => HeadTails(name).Select(item => item.Tail);

    /// Each tail with the leading words it sets aside.
    private static IEnumerable<(string Tail, string Dropped)> HeadTails(string name)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var spelling in new[] { CatalogService.Normalize(RemoveBracketed(name)), Expand(CatalogService.Normalize(RemoveBracketed(name))) })
        {
            var words = spelling.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            for (var start = 1; start <= words.Length - 2; start++)
            {
                var tail = string.Join(' ', words.Skip(start));
                if (seen.Add(tail)) yield return (tail, string.Join(' ', words.Take(start)));
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
        return new[] { expanded, Singular(normalized), Singular(expanded), WordSetKey(normalized), SquashedKey(normalized) }
            .Where(key => key.Length > 0 && key != normalized).Distinct();
    }

    /// A name with its spaces removed, prefixed so it never collides with a literal key. Short or single-word
    /// names are left out: with nothing to join there is no spacing to recover.
    internal static string SquashedKey(string normalized)
    {
        var joined = normalized.Replace(" ", "", StringComparison.Ordinal);
        return normalized.Contains(' ') && joined.Length >= 8 ? "=" + joined : "";
    }

    /// The same words written singly. A table says "Curls" where the library says "Curl".
    private static string Singular(string normalized)
        => string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Length > 3 && word.EndsWith('s') && !word.EndsWith("ss") ? word[..^1] : word));
}
