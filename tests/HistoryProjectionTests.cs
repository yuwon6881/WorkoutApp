using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// History reads copy every column except the start-of-workout snapshots. A column added later
/// and not copied would silently read as its default, so the generated SQL must name every
/// other mapped column and none of the snapshots.
public sealed class HistoryProjectionTests
{
    [Fact]
    public void Session_reads_leave_out_only_the_start_snapshots()
    {
        using var db = Open();
        AssertColumns(db, typeof(WorkoutSession), db.Workouts.AsNoTracking().WithoutSnapshots().ToQueryString(),
            nameof(WorkoutSession.StartPlanJson), nameof(WorkoutSession.NutritionContextJson));
    }

    [Fact]
    public void Exercise_reads_leave_out_only_the_start_snapshots()
    {
        using var db = Open();
        AssertColumns(db, typeof(SessionExercise), db.SessionExercises.AsNoTracking().WithoutSnapshots().ToQueryString(),
            nameof(SessionExercise.BaselineJson), nameof(SessionExercise.ProgressionJson));
    }

    [Fact]
    public void Set_reads_leave_out_only_the_start_suggestion()
    {
        using var db = Open();
        AssertColumns(db, typeof(CompletedSet), db.Sets.AsNoTracking().WithoutSnapshots().ToQueryString(),
            nameof(CompletedSet.SuggestionJson));
    }

    private static void AssertColumns(AppDb db, Type entity, string sql, params string[] omitted)
    {
        var columns = db.Model.FindEntityType(entity)!.GetProperties().Select(property => property.GetColumnName()).ToList();
        foreach (var column in columns.Where(column => !omitted.Contains(column)))
            Assert.True(sql.Contains($"\"{column}\""), $"{entity.Name}.{column} is not copied by its history projection.");
        foreach (var column in omitted)
            Assert.False(sql.Contains($"\"{column}\""), $"{entity.Name}.{column} should stay out of history reads.");
    }

    private static AppDb Open()
        => new(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options) { CurrentUser = Guid.NewGuid() };
}
