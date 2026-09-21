using Workout.Api.Domain;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ProgramDraftTests
{
    [Fact]
    public async Task CreateRetryWithSameRequestKeyReturnsTheSavedDraft()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var requestKey = Guid.NewGuid();
        var draft = new ImportDraft("Custom plan", [Day("Upper", [])]);

        var created = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(draft, requestKey), default);
        var retry = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(draft, requestKey), default);

        Assert.Equal(created.Id, retry.Id);
        Assert.Equal(created.Revision, retry.Revision);
        Assert.Single(await h.ProgramDrafts.List(default));
    }

    [Fact]
    public async Task DraftLimitIsNotReportedAsARevisionConflict()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        for (var index = 0; index < 20; index++)
            await h.ProgramDrafts.Create(new ProgramDraftCreateInput(new ImportDraft($"Plan {index}", [Day("Upper", [])])), default);

        var error = await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Create(
            new ProgramDraftCreateInput(new ImportDraft("Limit", [Day("Upper", [])])), default));

        Assert.Equal(422, error.Status);
    }

    [Fact]
    public async Task Drafts_AreIncompleteSafeRevisionCheckedAndTenantScoped()
    {
        await using var h = await Harness.Create();
        var firstUser = await h.SignIn();
        var draft = new ImportDraft("", [Day("", [])]);

        var created = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(draft), default);
        Assert.Equal(0, created.Revision);
        Assert.Equal("", created.Draft!.ProgramName);

        var edited = await h.ProgramDrafts.Update(created.Id,
            new ProgramDraftUpdateInput(draft with { ProgramName = "Custom plan" }, created.Revision), default);
        Assert.Equal(1, edited.Revision);
        Assert.Equal("Custom plan", edited.Draft!.ProgramName);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Update(created.Id,
            new ProgramDraftUpdateInput(draft, created.Revision), default))).Status);

        var otherUser = await h.CreateUser("bob");
        h.Db.CurrentUser = otherUser.Id;
        Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Get(created.Id, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Delete(created.Id, default))).Status);

        h.Db.CurrentUser = firstUser.Id;
        var eightDays = Enumerable.Range(1, 8).Select(index => Day($"Day {index}", [])).ToList();
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Create(
            new ProgramDraftCreateInput(new ImportDraft("Too many days", eightDays)), default))).Status);

        var firstDay = Day("Day 1", []);
        var conflictingIdentity = firstDay with { LineId = Guid.NewGuid(), BlockId = Guid.NewGuid() };
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Create(
            new ProgramDraftCreateInput(new ImportDraft("Mixed blocks", [firstDay, conflictingIdentity])), default))).Status);
    }

    [Fact]
    public async Task CustomProgramCreation_IsStandbyAtomicAndReplayable()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench-press", "Barbell bench press", "Chest", "Barbell", "Press", []));
        var exerciseId = await h.ExerciseId("bench-press");
        var exercise = new DraftExercise(Guid.NewGuid(), "Barbell bench press", exerciseId, null,
            [new DraftSet(8, 10, 8, 90, null, null, null)]);
        var created = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(
            new ImportDraft("Custom plan", [Day("Upper", [exercise])])), default);

        var program = await h.ProgramDrafts.CreateProgram(created.Id, new ProgramDraftCreateProgramInput(created.Revision), default);
        var retry = await h.ProgramDrafts.CreateProgram(created.Id, new ProgramDraftCreateProgramInput(created.Revision), default);

        Assert.Equal(program.Id, retry.Id);
        Assert.False(program.Active);
        Assert.Equal(ProgramLifecycle.Standby, program.LifecycleStatus);
        Assert.Single(program.Workouts);
        var tombstone = await h.ProgramDrafts.Get(created.Id, default);
        Assert.Null(tombstone.Draft);
        Assert.Equal(program.Id, tombstone.CreatedProgramId);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Delete(created.Id, default))).Status);
    }

    [Fact]
    public async Task DraftDocument_RejectsPayloadsOverStorageLimit()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var days = Enumerable.Range(1, 30).Select(week => Day("Day", Enumerable.Range(0, 40).Select(_ =>
            new DraftExercise(Guid.NewGuid(), "Exercise", null, new string('n', 1000), [])).ToList(), week)).ToList();

        var error = await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.Create(
            new ProgramDraftCreateInput(new ImportDraft("Plan", days)), default));
        Assert.Equal(413, error.Status);
    }

    [Fact]
    public async Task ProgramCreation_RequiresContiguousWeeksAndMappedExercises()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var gaps = new ImportDraft("Gapped plan", [Day("Day 1", [], 1), Day("Day 3", [], 3)]);
        var gapDraft = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(gaps), default);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.CreateProgram(
            gapDraft.Id, new ProgramDraftCreateProgramInput(gapDraft.Revision), default))).Status);

        var duplicateBlockName = new ImportDraft("Duplicate blocks", [
            Day("Day 1", [], 1),
            Day("Day 2", [], 2) with { BlockId = Guid.NewGuid() }
        ]);
        var duplicateBlocks = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(duplicateBlockName), default);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.CreateProgram(
            duplicateBlocks.Id, new ProgramDraftCreateProgramInput(duplicateBlocks.Revision), default))).Status);

        var unmappedExercise = new DraftExercise(Guid.NewGuid(), "Not selected", null, null,
            [new DraftSet(8, 10, 8, 90, null, null, null)]);
        var unmapped = await h.ProgramDrafts.Create(new ProgramDraftCreateInput(new ImportDraft("Unmapped plan",
            [Day("Upper", [unmappedExercise])])), default);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramDrafts.CreateProgram(
            unmapped.Id, new ProgramDraftCreateProgramInput(unmapped.Revision), default))).Status);
        Assert.NotNull((await h.ProgramDrafts.Get(unmapped.Id, default)).Draft);
    }

    private static DraftWorkout Day(string name, List<DraftExercise> exercises, int week = 1)
        => new(Guid.NewGuid(), week, name, null, null, exercises, Block: "Block 1", BlockId: BlockId,
            WeekId: Guid.Parse($"00000000-0000-0000-0000-{week:D12}"));

    private static readonly Guid BlockId = Guid.Parse("00000000-0000-0000-0000-000000000001");
}
