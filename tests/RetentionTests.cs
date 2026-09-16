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
    public async Task Terminal_imports_clear_heavy_json_and_delete_past_retention_window()
    {
        var user = await harness.SignIn();
        var now = DateTime.UtcNow;

        var oldTerminal = new AiImport
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Status = ImportStatus.Accepted,
            DraftJson = "{\"sample\": true}",
            OutlineJson = "[{\"week\": 1}]",
            AlternativesJson = "[{\"id\": \"alt1\"}]",
            PageCoverageJson = "[{\"page\": 1}]",
            Created = now.AddDays(-20)
        };

        var recentTerminal = new AiImport
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Status = ImportStatus.Failed,
            DraftJson = "{\"sample\": true}",
            OutlineJson = "[{\"week\": 1}]",
            AlternativesJson = "[{\"id\": \"alt1\"}]",
            PageCoverageJson = "[{\"page\": 1}]",
            Created = now.AddDays(-2)
        };

        var pendingImport = new AiImport
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            Status = ImportStatus.Pending,
            DraftJson = "{\"sample\": true}",
            Created = now.AddDays(-20)
        };

        harness.Db.Imports.AddRange(oldTerminal, recentTerminal, pendingImport);
        await harness.Db.SaveChangesAsync();

        var imports = harness.Imports(new FakeHandler());
        await imports.CleanupExpired(default);

        var importsInDb = await harness.Db.Imports.IgnoreQueryFilters().ToListAsync();

        // oldTerminal created 20 days ago (> 14 days) should be deleted
        Assert.DoesNotContain(importsInDb, i => i.Id == oldTerminal.Id);

        // recentTerminal created 2 days ago is kept, but its heavy JSON blobs must be cleared
        var recent = Assert.Single(importsInDb, i => i.Id == recentTerminal.Id);
        Assert.Equal("", recent.DraftJson);
        Assert.Equal("", recent.OutlineJson);
        Assert.Equal("[]", recent.AlternativesJson);
        Assert.Equal("[]", recent.PageCoverageJson);

        // pendingImport is not deleted by terminal age retention
        Assert.Contains(importsInDb, i => i.Id == pendingImport.Id);
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

    private sealed class FakeHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
    }
}
