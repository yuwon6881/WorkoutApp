using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class ImportDraftAlternatives
{
    public const string ExternalPromptVersion = "external-json-v1";
    /// The group a PDF read's offered versions are wrapped in so both kinds share one selector.
    public const string LegacyGroupId = "legacy";

    public static ImportDraft WithLegacyGroup(ImportDraft draft, List<ImportAlternative> alternatives)
        => draft.AlternativeGroups is { Count: > 0 } || alternatives.Count == 0 ? draft
            : draft with { AlternativeGroups = [new ImportAlternativeGroup(LegacyGroupId, alternatives)] };

    public static ImportDraft Select(ImportDraft draft, string alternativeId, string? groupId = null)
    {
        var groups = draft.AlternativeGroups ?? [];
        var matching = groups.Where(group => (groupId is null || string.Equals(group.Id, groupId, StringComparison.OrdinalIgnoreCase))
            && group.Members.Any(member => string.Equals(member.Id, alternativeId, StringComparison.OrdinalIgnoreCase))).ToList();
        Validation.Require(matching.Count == 1, "That alternative is no longer available.", 409);
        var group = matching[0];
        Validation.Require(group.Members.Count(member => string.Equals(member.Id, alternativeId, StringComparison.OrdinalIgnoreCase)) == 1,
            "That alternative is ambiguous.", 409);
        var chosen = group.Members.Single(member => string.Equals(member.Id, alternativeId, StringComparison.OrdinalIgnoreCase));
        // A PDF read's offered versions were always applied leniently (overlapping or since-removed days are
        // simply dropped); only an uploaded file, which has no earlier editing history, is held to a strict map.
        if (group.Id != LegacyGroupId)
        {
            var memberDays = group.Members.SelectMany(member => member.DayLineIds ?? []).ToList();
            var draftDays = draft.Workouts.Select(day => day.LineId).ToHashSet();
            Validation.Require(memberDays.Distinct().Count() == memberDays.Count && memberDays.All(draftDays.Contains),
                "Alternative members must refer to different days in this draft.", 409);
        }
        var dropped = group.Members.Where(member => member.Id != chosen.Id)
            .SelectMany(member => member.DayLineIds ?? []).ToHashSet();
        var kept = draft.Workouts.Where(day => !dropped.Contains(day.LineId)).ToList();
        var emptied = draft.Workouts.Select(day => day.Week).Except(kept.Select(day => day.Week)).ToList();
        return draft with
        {
            Workouts = [.. kept.Select(day =>
            {
                var week = day.Week - emptied.Count(empty => empty < day.Week);
                var shift = week - day.Week;
                return shift == 0 ? day : day with { Week = week, PhaseWeek = day.PhaseWeek > 0 ? Math.Max(1, day.PhaseWeek + shift) : day.PhaseWeek };
            })],
            AlternativeGroups = groups.Where(item => item != group).ToList(),
            AlternativeUncertainties = chosen.Uncertainty is { Flag: true } uncertainty
                ? [.. draft.AlternativeUncertainties ?? [], new ImportAlternativeUncertainty(chosen.Name, uncertainty)]
                : draft.AlternativeUncertainties
        };
    }
}
