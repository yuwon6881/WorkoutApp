using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class LoadSettingsEndpoints
{
    public static void MapLoadSettings(this WebApplication app)
    {
        app.MapGet("/api/load-settings", async (LoadSettingsService settings, CancellationToken ct) => await settings.Get(ct));
        app.MapPut("/api/load-settings/equipment/{group}", async (string group, LoadRuleInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveEquipment(group, input, ct));
        app.MapPost("/api/load-stacks", async (LoadStackInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveStack(null, input, ct));
        app.MapPut("/api/load-stacks/{id:guid}", async (Guid id, LoadStackInput input, LoadSettingsService settings, CancellationToken ct)
            => await settings.SaveStack(id, input, ct));
        app.MapDelete("/api/load-stacks/{id:guid}", async (Guid id, LoadSettingsService settings, CancellationToken ct)
            => await settings.DeleteStack(id, ct));
    }
}
