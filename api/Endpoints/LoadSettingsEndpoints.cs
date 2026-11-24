using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class LoadSettingsEndpoints
{
    public static void MapLoadSettings(this WebApplication app)
    {
        app.MapGet("/api/load-settings", async (string? unit, LoadSettingsService settings, CancellationToken ct) => await settings.Get(ct, unit));
        app.MapPut("/api/load-settings/equipment/{group}", async (string group, LoadRuleInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveEquipment(group, input, ct));
        app.MapGet("/api/gyms/{gymId:guid}/load-settings", async (Guid gymId, string? unit, LoadSettingsService settings, CancellationToken ct)
            => await settings.Get(ct, unit, gymId));
        app.MapPut("/api/gyms/{gymId:guid}/load-settings/equipment/{group}", async (Guid gymId, string group, LoadRuleInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveEquipment(group, input, ct, gymId));
    }
}
