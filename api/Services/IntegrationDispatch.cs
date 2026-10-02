namespace Workout.Api.Services;

/// Capability negotiation keeps older clients' active-user flush behavior unchanged.
public static class IntegrationDispatch
{
    public const string RequestHeader = "X-Fitness-Integration-Dispatch";
    public const string PendingHeader = "X-Fitness-Integration-Pending";

    public static async Task AfterCommit(HttpContext http, Func<Task<bool>> hasPending, Func<Task> inline)
    {
        if (http.Request.Headers[RequestHeader] != "deferred")
        {
            await inline();
            return;
        }
        if (await hasPending()) http.Response.Headers[PendingHeader] = "1";
    }
}
