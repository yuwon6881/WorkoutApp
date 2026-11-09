using System.Text.Json;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public record ImportRevisionInput(int? Revision, bool AcknowledgeUncertainty = false);

public static class ImportEndpoints
{
    public static void MapImports(this WebApplication app)
    {
        // Cloud Scheduler invokes this daily to run the retention sweep that keeps imports,
        // sessions, receipts, and usage rows bounded, and to retry Google Health uploads that
        // neither the finishing request nor a later visit managed to send. This service is
        // reachable without Cloud Run IAM, so the route answers 404 unless the caller presents an
        // allow-listed Google identity token.
        app.MapPost("/internal/import-maintenance", async (HttpRequest request, MaintenanceGate gate, ImportService imports, GoogleHealthWorkoutSyncService workoutSync, CancellationToken ct) =>
        {
            Validation.Require(await gate.Allow(request, ct), "Maintenance is not available.", 404);
            await imports.CleanupExpired(ct);
            var googleHealth = await workoutSync.ProcessDueAsync(ct);
            return Results.Ok(new { swept = true, googleHealth });
        }).DisableAntiforgery();

        app.MapGet("/api/imports", async (ImportService imports, CancellationToken ct) => await imports.List(ct));
        app.MapGet("/api/imports/external/prompt", () => Results.Ok(new { version = ExternalImportPrompt.Version, prompt = ExternalImportPrompt.Text }));
        app.MapPost("/api/imports/external", async (HttpRequest request, AppDb db, ImportService imports, CancellationToken ct) =>
        {
            Validation.Require(db.CurrentUser is not null, "Sign in to import a program.", 401);
            try
            {
                var json = await ExternalImportRequest.Read(request, ct);
                var view = await imports.CreateExternalImport(json, "external-import.json", ct);
                return Results.Ok(view);
            }
            catch (DomainException error)
            {
                var errors = ExternalImportPath.ErrorsOf(error);
                return Results.Json(new { message = error.Message, errors }, statusCode: error.Status);
            }
        }).RequireRateLimiting("external-import").DisableAntiforgery();
        app.MapGet("/api/imports/{id:guid}", async (Guid id, ImportService imports, CancellationToken ct) => await imports.Get(id, ct));

        app.MapPut("/api/imports/{id:guid}", async (Guid id, HttpRequest request, JsonElement payload, ImportService imports, CancellationToken ct) =>
        {
            int? revision = null;
            if (payload.TryGetProperty("revision", out var revEl) && revEl.TryGetInt32(out var r)) revision = r;
            else if (request.Headers.TryGetValue("If-Match", out var ifMatch) && int.TryParse(ifMatch, out var im)) revision = im;

            if (payload.TryGetProperty("workouts", out _))
                return await imports.Edit(id, Json.Read<ImportDraft>(payload.GetRawText()), revision, ct);
            return await imports.EditMetadata(id, Json.Read<ImportMetadata>(payload.GetRawText()), revision, ct);
        });
        app.MapPut("/api/imports/{id:guid}/days/{lineId:guid}", async (Guid id, Guid lineId, HttpRequest request, JsonElement payload, ImportService imports, CancellationToken ct) =>
        {
            int? revision = null;
            if (payload.TryGetProperty("revision", out var revEl) && revEl.TryGetInt32(out var r)) revision = r;
            else if (request.Headers.TryGetValue("If-Match", out var ifMatch) && int.TryParse(ifMatch, out var im)) revision = im;

            var day = Json.Read<DraftWorkout>(payload.GetRawText());
            return await imports.EditDay(id, lineId, day, revision, ct);
        });
        app.MapPut("/api/imports/{id:guid}/days", async (Guid id, ImportDaysInput input, ImportService imports, CancellationToken ct)
            => await imports.EditDays(id, input.Days ?? [], input.Revision, ct));
        app.MapPost("/api/imports/{id:guid}/restore", async (Guid id, ImportRestoreInput? input, ImportService imports, CancellationToken ct)
            => await imports.RestoreDraft(id, input?.Revision, ct));
        app.MapPost("/api/imports/{id:guid}/exercises/{exerciseLineId:guid}/restore", async (Guid id, Guid exerciseLineId, ImportRestoreInput? input, ImportService imports, CancellationToken ct)
            => await imports.RestoreExercise(id, exerciseLineId, input?.Revision, ct));
        app.MapPost("/api/imports/{id:guid}/exercises/{exerciseLineId:guid}/mapping", async (Guid id, Guid exerciseLineId, ImportSlotMappingInput? input, ImportService imports, CancellationToken ct)
            => await imports.MapSlot(id, exerciseLineId, input?.ReplacementExerciseId, input?.Revision, ct));
        app.MapPost("/api/imports/{id:guid}/alternative", async (Guid id, ImportAlternativeInput input, ImportService imports, CancellationToken ct)
            => await imports.SelectAlternative(id, input.AlternativeId, ct, input.GroupId));
        app.MapPost("/api/imports/{id:guid}/accept", async (Guid id, ImportRevisionInput? input, ImportService imports, CancellationToken ct) =>
            await imports.Accept(id, ct, input?.Revision, input?.AcknowledgeUncertainty ?? false));
        app.MapPost("/api/imports/{id:guid}/discard", async (Guid id, ImportService imports, CancellationToken ct) =>
        { await imports.Discard(id, ct); return Results.NoContent(); });
    }

}

public record ImportAlternativeInput(string AlternativeId, string? GroupId = null);
