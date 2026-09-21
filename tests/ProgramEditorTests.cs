using Workout.Api.Domain;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ProgramEditorTests
{
    [Fact]
    public async Task CustomProgramCreation_IsStandbyAndReplayProof()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench-press", "Barbell bench press", "Chest", "Barbell", "Press", []));
        var exerciseId = await h.ExerciseId("bench-press");
        var exercise = new DraftExercise(Guid.NewGuid(), "Barbell bench press", exerciseId, null,
            [new DraftSet(8, 10, 8, 90, null, null, null)]);
        var idempotencyId = Guid.NewGuid();
        var input = new ProgramEditorCreateInput(new ImportDraft("Custom plan", [Day("Upper", [exercise])]), idempotencyId);

        var program = await h.ProgramEditor.CreateProgram(input, default);

        Assert.False(program.Active);
        Assert.Equal(ProgramLifecycle.Standby, program.LifecycleStatus);
        Assert.Single(program.Workouts);
        // The same request replayed must not create a second program.
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(
            () => h.ProgramEditor.CreateProgram(input, default))).Status);
    }

    [Fact]
    public async Task ProgramDocument_RejectsPayloadsOverTheRequestLimit()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var days = Enumerable.Range(1, 30).Select(week => Day("Day", Enumerable.Range(0, 40).Select(_ =>
            new DraftExercise(Guid.NewGuid(), "Exercise", null, new string('n', 1000), [])).ToList(), week)).ToList();

        var error = await Assert.ThrowsAsync<DomainException>(() => h.ProgramEditor.CreateProgram(
            new ProgramEditorCreateInput(new ImportDraft("Plan", days)), default));

        Assert.Equal(413, error.Status);
    }

    [Fact]
    public async Task ProgramCreation_RequiresContiguousWeeksAndMappedExercises()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var gaps = new ImportDraft("Gapped plan", [Day("Day 1", [], 1), Day("Day 3", [], 3)]);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramEditor.CreateProgram(
            new ProgramEditorCreateInput(gaps), default))).Status);

        var duplicateBlockName = new ImportDraft("Duplicate blocks", [
            Day("Day 1", [], 1),
            Day("Day 2", [], 2) with { BlockId = Guid.NewGuid() }
        ]);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramEditor.CreateProgram(
            new ProgramEditorCreateInput(duplicateBlockName), default))).Status);

        var unmappedExercise = new DraftExercise(Guid.NewGuid(), "Not selected", null, null,
            [new DraftSet(8, 10, 8, 90, null, null, null)]);
        Assert.Equal(422, (await Assert.ThrowsAsync<DomainException>(() => h.ProgramEditor.CreateProgram(
            new ProgramEditorCreateInput(new ImportDraft("Unmapped plan", [Day("Upper", [unmappedExercise])])), default))).Status);
    }

    [Fact]
    public async Task ProgramDocument_RejectsMalformedWeekAndBlockIdentities()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var mismatchedWeek = new ImportDraft("Mixed identities", [
            Day("Day 1", [], 1),
            Day("Day 2", [], 1) with { WeekId = Guid.NewGuid() }
        ]);

        var error = await Assert.ThrowsAsync<DomainException>(() => h.ProgramEditor.CreateProgram(
            new ProgramEditorCreateInput(mismatchedWeek), default));

        Assert.Equal(400, error.Status);
    }

    private static DraftWorkout Day(string name, List<DraftExercise> exercises, int week = 1)
        => new(Guid.NewGuid(), week, name, null, null, exercises, Block: "Block 1", BlockId: BlockId,
            WeekId: Guid.Parse($"00000000-0000-0000-0000-{week:D12}"));

    private static readonly Guid BlockId = Guid.Parse("00000000-0000-0000-0000-000000000001");
}
