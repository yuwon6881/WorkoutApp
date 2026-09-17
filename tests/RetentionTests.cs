using System.Net;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class RetentionTests : IAsyncLifetime
{
    private Harness harness = null!;

    public async Task InitializeAsync()
    {
        harness = await Harness.Create(new Dictionary<string, string?>
        {
            ["Retention:ImportDays"] = "14",
            ["Retention:ReceiptDays"] = "30",
            ["Retention:AiUsageMonths"] = "1"
        });
    }

    public async Task DisposeAsync()
    {
        await harness.DisposeAsync();
    }

    [Fact]
    public async Task Prune_never_deletes_valid_session_and_preserves_authentication()
    {
        var user = await harness.SignIn();
        var now = DateTime.UtcNow;

        var expiredToken = Guid.NewGuid().ToString("N");
        var validToken = Guid.NewGuid().ToString("N");

        harness.Db.Sessions.AddRange(
            new AuthSession { Hash = AuthService.Hash(expiredToken), UserId = user.Id, Expires = now.AddDays(-1) },
            new AuthSession { Hash = AuthService.Hash(validToken), UserId = user.Id, Expires = now.AddDays(15) }
        );
        await harness.Db.SaveChangesAsync();

        var imports = harness.Imports(new FakeHandler());
        await imports.CleanupExpired(default);

        var remaining = await harness.Db.Sessions.Where(s => s.UserId == user.Id).ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(AuthService.Hash(validToken), remaining[0].Hash);
    }

    [Fact]
    public async Task MutationReceipts_older_than_retention_window_are_deleted()
    {
        var user = await harness.SignIn();
        var now = DateTime.UtcNow;

        var oldReceipt = new MutationReceipt { UserId = user.Id, Id = Guid.NewGuid(), Created = now.AddDays(-40) };
        var recentReceipt = new MutationReceipt { UserId = user.Id, Id = Guid.NewGuid(), Created = now.AddDays(-5) };

        harness.Db.Receipts.AddRange(oldReceipt, recentReceipt);
        await harness.Db.SaveChangesAsync();

        var imports = harness.Imports(new FakeHandler());
        await imports.CleanupExpired(default);

        var remaining = await harness.Db.Receipts.IgnoreQueryFilters().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recentReceipt.Id, remaining[0].Id);
    }

    [Fact]
    public async Task AiUsage_older_than_retention_window_is_deleted()
    {
        var user = await harness.SignIn();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var oldUsage = new AiUsage { UserId = user.Id, Date = today.AddDays(-45), Count = 5 };
        var recentUsage = new AiUsage { UserId = user.Id, Date = today.AddDays(-10), Count = 3 };

        harness.Db.Usage.AddRange(oldUsage, recentUsage);
        await harness.Db.SaveChangesAsync();

        var imports = harness.Imports(new FakeHandler());
        await imports.CleanupExpired(default);

        var remaining = await harness.Db.Usage.IgnoreQueryFilters().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recentUsage.Date, remaining[0].Date);
    }

    /// Imports are unfinished work, not history: a finished one is deleted as it finishes and an
    /// abandoned one is deleted by age. Neither is kept blank, because blanking a draft the user
    /// has not reviewed destroys the very thing they came back for.
    [Fact]
    public async Task Abandoned_imports_are_deleted_by_age_and_recent_drafts_are_left_intact()
    {
        var user = await harness.SignIn();
        var now = DateTime.UtcNow;
        var abandoned = new AiImport
        {
            Id = Guid.NewGuid(), UserId = user.Id, Status = ImportStatus.Ready,
            DraftJson = "{\"sample\": true}", Created = now.AddDays(-120)
        };
        var reviewable = new AiImport
        {
            Id = Guid.NewGuid(), UserId = user.Id, Status = ImportStatus.Ready,
            DraftJson = "{\"sample\": true}", OutlineJson = "[{\"week\": 1}]", Created = now.AddDays(-2)
        };
        harness.Db.Imports.AddRange(abandoned, reviewable);
        await harness.Db.SaveChangesAsync();

        await harness.Imports(new FakeHandler()).CleanupExpired(default);

        var rows = await harness.Db.Imports.IgnoreQueryFilters().ToListAsync();
        Assert.DoesNotContain(rows, i => i.Id == abandoned.Id);
        var kept = Assert.Single(rows, i => i.Id == reviewable.Id);
        Assert.Equal("{\"sample\": true}", kept.DraftJson);
        Assert.Equal("[{\"week\": 1}]", kept.OutlineJson);
    }

    private sealed class FakeHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
    }
}
