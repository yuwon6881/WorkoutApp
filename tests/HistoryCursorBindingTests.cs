using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore.Diagnostics;
using System.Data.Common;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class HistoryCursorBindingTests
{
    [Theory]
    [InlineData("2026-10-15T02:00:00.000Z", DateTimeKind.Utc)]
    [InlineData("2026-10-15T10:00:00+08:00", DateTimeKind.Utc)]
    [InlineData("2026-10-15T02:00:00", DateTimeKind.Unspecified)]
    public async Task Binding_and_normalization_preserve_the_cursor_instant(string text, DateTimeKind kind)
    {
        using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        DateTime? bound = null;
        var endpoint = RequestDelegateFactory.Create((DateTime? beforeAt) => { bound = beforeAt; },
            new RequestDelegateFactoryOptions { ServiceProvider = services });
        var context = new DefaultHttpContext { RequestServices = services };
        context.Request.QueryString = QueryString.Create("beforeAt", text);
        await endpoint.RequestDelegate(context);
        Assert.Equal(kind, bound!.Value.Kind);
        Assert.Equal(new DateTime(2026, 10, 15, 2, 0, 0, DateTimeKind.Utc), HistoryCursorTime.Utc(bound.Value));
        Assert.Equal(DateTimeKind.Utc, HistoryCursorTime.Utc(bound.Value).Kind);
    }

    [Theory]
    [InlineData(DateTimeKind.Utc)]
    [InlineData(DateTimeKind.Local)]
    [InlineData(DateTimeKind.Unspecified)]
    public async Task Both_history_readers_accept_supported_cursor_kinds(DateTimeKind kind)
    {
        var observer = new CursorParameters();
        await using var h = await Harness.Create(observer: observer);
        await h.SignIn();
        var instant = new DateTime(2026, 10, 15, 2, 0, 0, DateTimeKind.Utc);
        var cursor = kind == DateTimeKind.Local ? instant.ToLocalTime() : DateTime.SpecifyKind(instant, kind);
        Assert.Equal(instant, HistoryCursorTime.Utc(cursor));
        Assert.Equal(DateTimeKind.Utc, HistoryCursorTime.Utc(cursor).Kind);
        observer.Dates.Clear();
        await HistoryReadService.Get(h.Db, cursor, Guid.NewGuid(), 20, default);
        Assert.NotEmpty(observer.Dates);
        Assert.All(observer.Dates, value => Assert.Equal(DateTimeKind.Utc, value.Kind));
        observer.Dates.Clear();
        await h.Workouts.HistoryCursor(cursor, Guid.NewGuid(), 20, default);
        Assert.NotEmpty(observer.Dates);
        Assert.All(observer.Dates, value => Assert.Equal(DateTimeKind.Utc, value.Kind));
    }

    private sealed class CursorParameters : DbCommandInterceptor
    {
        public List<DateTime> Dates { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Dates.AddRange(command.Parameters.Cast<DbParameter>().Select(x => x.Value).OfType<DateTime>());
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
