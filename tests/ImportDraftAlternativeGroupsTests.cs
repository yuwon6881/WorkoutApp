using Workout.Api.Domain;
using Workout.Api.Services;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class ImportDraftAlternativeGroupsTests
{
    [Fact]
    public async Task Stored_draft_groups_can_be_selected_without_pdf_source_pages()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        DraftWorkout Day(int week, string name) => new(Guid.NewGuid(), week, name, null, null, [], IsRestDay: true);
        var a = Day(1, "A"); var b = Day(1, "B"); var c = Day(2, "C"); var d = Day(2, "D");
        List<ImportAlternativeGroup> groups = [
            new("first", [new("a", "A", 0, 0, Kind: ImportAlternativeKinds.Week, DayLineIds: [a.LineId]) { Uncertainty = new(true, "Check option A") },
                new("b", "B", 0, 0, Kind: ImportAlternativeKinds.Week, DayLineIds: [b.LineId])]),
            new("second", [new("c", "C", 0, 0, Kind: ImportAlternativeKinds.Week, DayLineIds: [c.LineId]),
                new("d", "D", 0, 0, Kind: ImportAlternativeKinds.Week, DayLineIds: [d.LineId])])
        ];
        var draft = new ImportDraft("Program", [a, b, c, d]) { AlternativeGroups = groups };
        var row = new AiImport { UserId = h.Db.CurrentUser!.Value, FileName = "external.json", PromptVersion = ImportDraftAlternatives.ExternalPromptVersion, Status = ImportStatus.Pending,
            Stage = "select", DraftJson = Json.Write(draft), AlternativesJson = Json.Write(groups[0].Members) };
        h.Db.Imports.Add(row);
        await h.Db.SaveChangesAsync();
        var imports = h.Imports(StubHandler.Program("{}"));

        var first = await imports.SelectAlternative(row.Id, "a", default, "first");
        Assert.Equal("select", first.Stage);
        Assert.Equal(["c", "d"], first.Alternatives!.Select(item => item.Id));
        var second = await imports.SelectAlternative(row.Id, "d", default, "second");
        Assert.Equal(ImportStatus.Ready, second.Status);
        Assert.Equal(["A", "D"], second.Draft!.Workouts.Select(day => day.Name));
        Assert.Contains(second.ReviewIssues!, issue => issue.Code == "external_uncertainty" && issue.Message.Contains("Check option A"));
        await Assert.ThrowsAsync<DomainException>(() => imports.Accept(row.Id, default, second.Revision));
    }
    [Fact]
    public void Selection_uses_member_ids_without_source_pages_and_keeps_other_groups()
    {
        DraftWorkout Day(int week, string name) => new(Guid.NewGuid(), week, name, null, null, []);
        var a = Day(1, "A"); var b = Day(1, "B"); var c = Day(2, "C"); var d = Day(2, "D");
        List<ImportAlternativeGroup> groups = [
            new("first", [new("a", "A", 0, 1, DayLineIds: [a.LineId]), new("b", "B", 0, 1, DayLineIds: [b.LineId])]),
            new("second", [new("c", "C", 0, 1, DayLineIds: [c.LineId]), new("d", "D", 0, 1, DayLineIds: [d.LineId])])
        ];
        var draft = new ImportDraft("Program", [a, b, c, d]) { AlternativeGroups = groups };
        var selected = ImportDraftAlternatives.Select(draft, "a");
        Assert.Equal([a.LineId, c.LineId, d.LineId], selected.Workouts.Select(day => day.LineId));
        Assert.Equal("second", Assert.Single(selected.AlternativeGroups!).Id);
        Assert.Throws<DomainException>(() => ImportDraftAlternatives.Select(draft, "missing"));
        var duplicate = draft with { AlternativeGroups = [groups[0], new ImportAlternativeGroup("third", [groups[0].Members[0]])] };
        Assert.Throws<DomainException>(() => ImportDraftAlternatives.Select(duplicate, "a"));
        Assert.Single(ImportDraftAlternatives.Select(duplicate, "a", "first").AlternativeGroups!);
        var overlapping = draft with { AlternativeGroups = [new ImportAlternativeGroup("bad", [
            new("a", "A", 0, 1, DayLineIds: [a.LineId]), new("b", "B", 0, 1, DayLineIds: [a.LineId])])] };
        Assert.Throws<DomainException>(() => ImportDraftAlternatives.Select(overlapping, "a", "bad"));
    }
}
