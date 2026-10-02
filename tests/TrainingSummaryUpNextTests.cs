using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class TrainingSummaryUpNextTests
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    [Fact]
    public async Task The_active_program_week_lists_unpassed_training_days_in_program_order()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var program = new TrainingProgram { UserId = user.Id, Name = "Powerbuilding", Active = true, LifecycleStatus = ProgramLifecycle.Active };
        var run = new ProgramRun { UserId = user.Id, ProgramId = program.Id, Number = 1, CurrentWeek = 1, CurrentAttempt = 1 };
        WorkoutTemplate Day(string name, int position, bool rest = false)
            => new() { UserId = user.Id, ProgramId = program.Id, Name = name, Week = 1, Position = position, IsRestDay = rest };
        var skipped = Day("Full Body 1", 0);
        var pending = Day("Full Body 2", 1);
        var rest = Day("Rest Day", 2, rest: true);
        var noRow = Day("Full Body 3", 3);
        var inProgress = Day("Full Body 4", 4);
        var nextWeek = new WorkoutTemplate { UserId = user.Id, ProgramId = program.Id, Name = "Week 2 day", Week = 2, Position = 0 };
        h.Db.Programs.Add(program);
        h.Db.ProgramRuns.Add(run);
        h.Db.Templates.AddRange(skipped, pending, rest, noRow, inProgress, nextWeek);
        h.Db.ProgramDayProgresses.AddRange(
            new ProgramDayProgress { UserId = user.Id, ProgramId = program.Id, RunId = run.Id, TemplateId = skipped.Id, Week = 1, Status = ProgramDayStatus.Skipped },
            new ProgramDayProgress { UserId = user.Id, ProgramId = program.Id, RunId = run.Id, TemplateId = pending.Id, Week = 1 });
        h.Db.Workouts.Add(new WorkoutSession { UserId = user.Id, Name = "Full Body 4", TemplateId = inProgress.Id, ProgramId = program.Id, Active = true, StartedAt = DateTime.UtcNow });
        await h.Db.SaveChangesAsync();

        var summaries = await h.Workouts.TrainingSummary(Today.AddDays(-7), Today, "UTC", default);

        var upNext = summaries.Where(item => item.Status == "upcoming").ToList();
        Assert.Equal(["Full Body 2", "Full Body 3"], upNext.Select(item => item.WorkoutName));
        Assert.All(upNext, item => { Assert.False(item.Completed); Assert.Null(item.StartedAt); Assert.Equal(Today, item.LocalDate); });
        Assert.Contains(summaries, item => item.Status == "in_progress" && item.WorkoutName == "Full Body 4");
    }

    [Fact]
    public async Task Up_next_days_belong_only_to_a_range_that_includes_today()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        h.Db.Templates.Add(new WorkoutTemplate { UserId = user.Id, Name = "Standalone push", Active = true });
        await h.Db.SaveChangesAsync();

        Assert.Equal("Standalone push", Assert.Single(await h.Workouts.TrainingSummary(Today, Today, "UTC", default)).WorkoutName);
        Assert.Empty(await h.Workouts.TrainingSummary(Today.AddDays(-7), Today.AddDays(-1), "UTC", default));
    }

    [Fact]
    public async Task A_finished_standalone_workout_is_not_up_next()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        h.Db.Templates.Add(new WorkoutTemplate { UserId = user.Id, Name = "Standalone push", Active = true, ActiveCompletedAt = DateTime.UtcNow });
        await h.Db.SaveChangesAsync();

        Assert.Empty(await h.Workouts.TrainingSummary(Today, Today, "UTC", default));
    }
}
