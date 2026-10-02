using Microsoft.AspNetCore.Http;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class DeferredIntegrationDispatchTests
{
    [Theory]
    [InlineData(null, true)]
    [InlineData("deferred", false)]
    [InlineData("unexpected", true)]
    public async Task Only_opted_in_clients_skip_inline_provider_work(string? dispatch, bool inline)
    {
        var http = new DefaultHttpContext();
        if (dispatch is not null) http.Request.Headers[IntegrationDispatch.RequestHeader] = dispatch;
        var called = false;
        await IntegrationDispatch.AfterCommit(http, () => Task.FromResult(true), () => { called = true; return Task.CompletedTask; });
        Assert.Equal(inline, called);
        Assert.Equal(inline ? "" : "1", http.Response.Headers[IntegrationDispatch.PendingHeader].ToString());
    }

    [Fact]
    public async Task An_opted_in_save_without_queue_work_does_not_schedule_a_pass()
    {
        var http = new DefaultHttpContext();
        http.Request.Headers[IntegrationDispatch.RequestHeader] = "deferred";
        await IntegrationDispatch.AfterCommit(http, () => Task.FromResult(false), () => throw new Exception("Provider must not run"));
        Assert.False(http.Response.Headers.ContainsKey(IntegrationDispatch.PendingHeader));
    }
}
