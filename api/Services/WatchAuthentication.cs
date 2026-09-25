using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class WatchAuthentication
{
    public const string DeviceTokenHeader = "X-Workout-Device-Token";
    public const string WearClientHeader = "X-Workout-Wear-Client";
    // Active watch links slide forward to a one-year idle deadline, with at most one database
    // update per day per device. A token that has already expired still requires fresh pairing.
    public static readonly TimeSpan DeviceSessionLifetime = TimeSpan.FromDays(365);
    private static readonly TimeSpan DeviceSessionRenewalWindow = TimeSpan.FromDays(364);

    public static bool IsPairingBootstrap(HttpRequest request)
        => HttpMethods.IsPost(request.Method) && request.Path.Value is "/api/watch/pairing/start" or "/api/watch/pairing/status";

    public static bool CanUseDeviceSession(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        if (HttpMethods.IsGet(request.Method) && path is "/api/watch/active") return true;
        if (HttpMethods.IsPost(request.Method) && path is "/api/watch/session/revoke") return true;

        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 4 && segments[0] == "api" && segments[1] == "watch" && segments[2] == "workouts" && Guid.TryParse(segments[3], out _))
            return HttpMethods.IsGet(request.Method);

        if (segments.Length == 6 && segments[0] == "api" && segments[1] == "watch" && segments[2] == "workouts" &&
            Guid.TryParse(segments[3], out _) && Guid.TryParse(segments[5], out _) && segments[4] == "sets")
            return HttpMethods.IsPatch(request.Method);

        return segments.Length == 5 && segments[0] == "api" && segments[1] == "watch" && segments[2] == "workouts" &&
            Guid.TryParse(segments[3], out _) && segments[4] is "pause" or "resume" or "finish" && HttpMethods.IsPost(request.Method);
    }

    public static async Task<Guid?> FindAccountForDeviceToken(AppDb db, string token, CancellationToken ct)
    {
        var tokenHash = AuthService.Hash(token);
        var now = DateTime.UtcNow;
        var device = await db.WatchDevices.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TokenHash == tokenHash && item.RevokedAt == null && item.ExpiresAt > now)
            .Select(item => new { item.Id, item.UserId, item.ExpiresAt })
            .SingleOrDefaultAsync(ct);
        if (device is null) return null;

        if (device.ExpiresAt - now <= DeviceSessionRenewalWindow)
        {
            var renewed = await db.WatchDevices.IgnoreQueryFilters()
                .Where(item => item.Id == device.Id && item.TokenHash == tokenHash && item.RevokedAt == null && item.ExpiresAt > now)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiresAt, now.Add(DeviceSessionLifetime)), ct);
            if (renewed != 1) return null;
        }

        return device.UserId;
    }
}
