using Microsoft.EntityFrameworkCore;
using Xunit;
using static Workout.Tests.ProgramEditRig;

namespace Workout.Tests;

public class ProgramDayDeleteTests
{
    [Fact]
    public async Task Direct_template_deletion_cannot_bypass_the_program_editor()
    {
        await using var rig = await Ready();
        var program = await Active(rig);
        var completed = Day(program, "W1 A");
        await Complete(rig.H, completed.Id);

        foreach (var day in program.Workouts)
        {
            var error = await Refused(rig.H.Templates.Delete(day.Id, default));
            Assert.Contains("program editor", error.Message);
            Assert.True(await rig.H.Db.Templates.AnyAsync(row => row.Id == day.Id));
        }

        var saved = await rig.H.Programs.Get(program.Id, default);
        Assert.Contains(completed.Id, saved.CompletedTemplateIds);
        Assert.Equal(program.Workouts.Count, saved.Workouts.Count);
    }

    [Fact]
    public async Task A_standalone_template_can_still_be_deleted()
    {
        await using var rig = await Ready();
        var template = await rig.H.Templates.Create(Harness.Template("Standalone",
            Harness.Exercise(rig.Bench, "Bench press", Harness.Set(8, 10))), null, 1, 0, default);

        await rig.H.Templates.Delete(template.Id, default);

        Assert.False(await rig.H.Db.Templates.AnyAsync(row => row.Id == template.Id));
    }
}