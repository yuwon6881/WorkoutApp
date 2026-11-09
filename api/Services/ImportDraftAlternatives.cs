using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class ImportDraftAlternatives
{
    public const string ExternalPromptVersion = "external-json-v1";

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
        var memberDays = group.Members.SelectMany(member => member.DayLineIds ?? []).ToList();
        var draftDays = draft.Workouts.Select(day => day.LineId).ToHashSet();
        Validation.Require(memberDays.Distinct().Count() == memberDays.Count && memberDays.All(draftDays.Contains),
            "Alternative members must refer to different days in this draft.", 409);
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
