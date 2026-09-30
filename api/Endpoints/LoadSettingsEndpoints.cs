using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class LoadSettingsEndpoints
{
    public static void MapLoadSettings(this WebApplication app)
    {
        app.MapGet("/api/load-settings", async (LoadSettingsService settings, CancellationToken ct) => await settings.Get(ct));
        app.MapPut("/api/load-settings/equipment/{group}", async (string group, LoadRuleInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveEquipment(group, input, ct));
    }
}
