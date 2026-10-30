using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class GymEndpoints
{
    public static void MapGyms(this WebApplication app)
    {
        app.MapGet("/api/gyms", async (GymProfileService gyms, CancellationToken ct) => await gyms.Get(ct));
        app.MapPost("/api/gyms", async (GymProfileCreateInput input, GymProfileService gyms, CancellationToken ct)
            => await gyms.Create(input, ct));
        app.MapPut("/api/gyms/{id:guid}", async (Guid id, GymProfileUpdateInput input, GymProfileService gyms, CancellationToken ct)
            => await gyms.Update(id, input, ct));
        app.MapPost("/api/gyms/{id:guid}/activate", async (Guid id, GymProfileService gyms, CancellationToken ct)
            => await gyms.Activate(id, ct));
        app.MapDelete("/api/gyms/{id:guid}", async (Guid id, GymProfileService gyms, CancellationToken ct)
            => await gyms.Delete(id, ct));
    }
}
