using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Xunit;

namespace Workout.Tests;

/// A draft still waiting for a version choice is working state; one nobody returned to is swept.
public sealed class ImportCleanupTests
{
    private static AiImport Waiting(Guid userId, DateTime created) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, Status = ImportStatus.Pending, Stage = "select",
        FileName = "external-import.json", Created = created
    };

    [Fact]
    public async Task A_pending_import_older_than_a_day_is_swept_and_a_recent_one_stays()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        var stale = Waiting(user.Id, DateTime.UtcNow.AddDays(-2));
        var recent = Waiting(user.Id, DateTime.UtcNow.AddHours(-2));
        h.Db.Imports.AddRange(stale, recent);
        await h.Db.SaveChangesAsync();

        await h.Imports().CleanupExpired(default);

        var rows = await h.Db.Imports.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(recent.Id, Assert.Single(rows).Id);
    }
}
