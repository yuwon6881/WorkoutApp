using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Workout.Api.Services;

/// Which exercises of a draft are one recurring slot, and which are one mapping decision.
internal static partial class ImportValidation
{
    public static List<UnresolvedExercise> Unresolved(ImportDraft draft)
    {
        var unresolved = draft.Workouts.Where(w => !w.IsRestDay)
            .SelectMany(w => w.Exercises.Select((exercise, position) => (workout: w, exercise, position)))
            .Where(item => item.exercise.ExerciseId == null)
            .ToList();
        return unresolved
            .GroupBy(item => MappingKey(item.workout, item.exercise.SourceName), StringComparer.Ordinal)
            .Select(group =>
            {
                var first = group.First();
                var blocks = group.Select(item => CanonicalBlock(item.workout.Block)).Where(block => block.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                return new UnresolvedExercise(first.exercise.LineId, RepresentativeName(group.Select(item => item.exercise.SourceName)),
                    first.exercise.SlotKey,
                    blocks.Count == 1 ? blocks[0] : null,
                    group.Count());
            })
            .ToList();
    }

    /// The decision one mapping makes. A written name means one library movement wherever the
    /// block prints it, so it is linked once for every day, week and position that name appears
    /// at, however the page cased or punctuated it. Keying it on the day and position instead
    /// asked for "Seated Face Pull" once per week, and linked whatever movement shared its
    /// position in another week along with it.
    public static string MappingKey(DraftWorkout workout, string? sourceName)
        => IsRecurringChoice(sourceName)
            ? $"choice\u001f{ChoiceIdentity(sourceName)}"
            : $"{CanonicalBlock(workout.Block).ToUpperInvariant()}\u001f{MovementIdentity(sourceName)}";

    private static string MovementIdentity(string? sourceName)
        => CatalogMatching.Expand(CatalogService.Normalize(sourceName ?? ""));

    /// Canonicalizes imported structural labels and assigns a stable recurring slot identity. The
    /// key is deliberately based on the block, workout name, and exercise position: a document may
    /// spell the same movement differently on one page, but a reviewer still means the same slot.
    public static ImportDraft NormalizeDraft(ImportDraft draft)
    {
        var slots = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        var signaturesBySlot = new Dictionary<Guid, string>();
        var workouts = draft.Workouts.Select(workout =>
        {
            var block = string.IsNullOrWhiteSpace(workout.Block) ? workout.Block : CanonicalBlock(workout.Block);
            var exercises = workout.Exercises.Select((exercise, position) =>
            {
                var signature = SlotSignature(workout with { Block = block }, position, exercise.SourceName);
                if (!slots.TryGetValue(signature, out var slot))
                {
                    var candidate = exercise.SlotKey;
                    if (candidate is null || signaturesBySlot.TryGetValue(candidate.Value, out var owner) &&
                        !string.Equals(owner, signature, StringComparison.Ordinal))
                        candidate = StableGuid(signature);

                    slot = candidate.Value;
                    slots[signature] = slot;
                    signaturesBySlot[slot] = signature;
                }

                return exercise with { SlotKey = slot };
            }).ToList();
            return workout with { Block = block, Exercises = exercises };
        }).ToList();
        return draft with { Workouts = workouts };
    }

    public static string SlotSignature(DraftWorkout workout, int position)
        => $"{CanonicalBlock(workout.Block).ToUpperInvariant()}\u001f{DayIdentity(workout.Name)}\u001f{position}";

    /// A day's name without the week it falls in. "Week 3 day 2" is the same session as "Week 4
    /// day 2", so the week a title carries must not split one recurring slot into one per week.
    private static string DayIdentity(string? name)
    {
        var withoutWeek = Regex.Replace(Collapse(name), @"\b(?:week|wk)\s*\d+[a-z]?\b", " ", RegexOptions.IgnoreCase);
        var trimmed = Collapse(Regex.Replace(withoutWeek, @"^[\s\-–:|·,]+|[\s\-–:|·,]+$", ""));
        return trimmed.Length > 0 ? trimmed.ToUpperInvariant() : Identity(name);
    }

    /// A "pick one" placeholder is a single decision for the whole program, however the document
    /// places it. Keying it on the day title and the position within that day split one decision
    /// into a review row per placement: the same upper-body weak point printed on six differently
    /// titled days, at shifting positions, wanted six mappings instead of one.
    public static string SlotSignature(DraftWorkout workout, int position, string? sourceName)
        => IsRecurringChoice(sourceName)
            ? $"choice\u001f{ChoiceIdentity(sourceName)}"
            : SlotSignature(workout, position);

    /// A lone placeholder is printed "... 1" whether or not a second one exists, and the trailing
    /// ordinal survives transcription only some of the time, which splits one slot in two. A
    /// higher ordinal genuinely names a further placeholder and is kept.
    private static string ChoiceIdentity(string? sourceName)
        => Regex.Replace(Identity(sourceName), @"\s+1$", "");

    private static bool IsRecurringChoice(string? sourceName)
        => Regex.IsMatch(sourceName ?? "", @"\b(?:your\s+choice|weak\s+point|pick\s+one|choose\s+one)\b", RegexOptions.IgnoreCase);

    private static string RepresentativeName(IEnumerable<string> names)
        => names.Where(name => !string.IsNullOrWhiteSpace(name)).GroupBy(Identity)
            .OrderByDescending(group => group.Count()).ThenBy(group => group.First(), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First().Trim()).FirstOrDefault() ?? "Unnamed exercise";

    private static Guid StableGuid(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        Span<byte> guid = stackalloc byte[16];
        bytes.AsSpan(0, 16).CopyTo(guid);
        guid[6] = (byte)((guid[6] & 0x0F) | 0x50);
        guid[8] = (byte)((guid[8] & 0x3F) | 0x80);
        return new Guid(guid);
    }
}
