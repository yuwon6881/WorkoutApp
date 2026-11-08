using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

public sealed class SqliteImportCompatibilityTests
{
    [Fact]
    public async Task Adds_the_effort_capability_to_an_existing_sqlite_database_without_losing_programs()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var oldImportId = Guid.NewGuid();
        var program = new TrainingProgram { UserId = user.Id, Name = "Existing program", SourceImportId = oldImportId };
        h.Db.Programs.Add(program);
        await h.Db.SaveChangesAsync();
        await h.Db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Programs\" DROP COLUMN \"AllowUnspecifiedEffort\"");
        await SqliteImportCompatibility.EnsureEffortCapability(h.Db, default);
        await SqliteImportCompatibility.EnsureEffortCapability(h.Db, default);
        h.Db.ChangeTracker.Clear();
        var restored = await h.Db.Programs.SingleAsync(item => item.Id == program.Id);
        Assert.Equal("Existing program", restored.Name);
        Assert.Equal(oldImportId, restored.SourceImportId);
        Assert.False(restored.AllowUnspecifiedEffort);
    }
}
