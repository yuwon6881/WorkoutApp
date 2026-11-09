using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// The program is already converted; choosing an alternative only decides which version's days stay.
    public async Task<ImportView> SelectAlternative(Guid id, string alternativeId, CancellationToken ct, string? groupId = null)
    {
        await using (var gate = await MutationLock.Acquire(db, db.CurrentUser, ct))
        {
            var import = await db.Imports.SingleOrDefaultAsync(i => i.Id == id, ct);
            Validation.Require(import != null, "That import no longer exists.", 404);
            Validation.Require(import!.Status == ImportStatus.Pending && import.Stage == "select", "This import is not waiting for an alternative selection.", 409);
            var alternatives = string.IsNullOrWhiteSpace(import.AlternativesJson) ? [] : Json.Read<List<ImportAlternative>>(import.AlternativesJson);
            if (!string.IsNullOrEmpty(import.DraftJson) && Json.Read<ImportDraft>(import.DraftJson).AlternativeGroups is { } groups)
            {
                var activeGroup = groups.FirstOrDefault(group =>
                    (groupId is null || string.Equals(group.Id, groupId, StringComparison.OrdinalIgnoreCase)) &&
                    group.Members.Any(member => string.Equals(member.Id, alternativeId, StringComparison.OrdinalIgnoreCase)));
                Validation.Require(groupId is null || activeGroup is not null, "That alternative group is no longer available.", 409);
                if (activeGroup is not null) alternatives = activeGroup.Members;
            }
            var selected = alternatives.SingleOrDefault(a => string.Equals(a.Id, alternativeId, StringComparison.OrdinalIgnoreCase));
            Validation.Require(selected is not null, "That alternative is no longer available.", 409);
            Validation.Require(selected!.DayLineIds is { Count: > 0 }, "That alternative is no longer available.", 409);
            ChooseAlternative(import, selected, alternatives, groupId);
            await ValidateDraft(Json.Read<ImportDraft>(import.DraftJson), ct);
            import.Revision++;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }
        db.ChangeTracker.Clear();
        return await Get(id, ct);
    }

    /// Keeps the chosen version and makes the draft ready for review, or offers the next group's choice.
    private void ChooseAlternative(AiImport import, ImportAlternative chosen, IReadOnlyList<ImportAlternative> offered, string? groupId)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(import.DraftJson), "This import has no draft to choose from.", 409);
        var draft = ImportValidation.NormalizeDraft(ImportDraftAlternatives.Select(Json.Read<ImportDraft>(import.DraftJson), chosen.Id, groupId));
        import.NoticesJson = Json.Write(ImportReviewNotices.Merge(ReadNotices(import.NoticesJson), [ImportWeekChoice.ChosenNotice(chosen, offered)]));
        import.DraftJson = Json.Write(draft);
        import.DraftBaselineJson = import.DraftJson;
        import.SelectedAlternativeId = chosen.Id;
        var next = draft.AlternativeGroups?.FirstOrDefault();
        import.Status = next is null ? ImportStatus.Ready : ImportStatus.Pending;
        import.Stage = next is null ? "done" : "select";
        if (next is not null) import.AlternativesJson = Json.Write(next.Members);
        UpdateCounters(import, draft);
    }
}
