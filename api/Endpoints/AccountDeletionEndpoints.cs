using Workout.Api.Services;

namespace Workout.Api.Endpoints;

public static class AccountDeletionEndpoints
{
    /// Sibling of the central sign-in callback, so Fitness Account reaches it wherever sign-in works.
    /// It is called server-to-server: the signed notice is its only credential, so it is exempt from
    /// the browser session and same-origin request checks.
    public const string Path = "/api/auth/central/account-deleted";
    private const string FormField = "deletion_token";

    public static void MapAccountDeletion(this WebApplication app)
    {
        app.MapPost(Path, async (HttpRequest request, IAccountDeletionNoticeValidator notices, AccountErasureService erasure, CancellationToken ct) =>
        {
            var token = request.HasFormContentType ? (await request.ReadFormAsync(ct))[FormField].ToString() : "";
            var subject = await notices.ValidateAsync(token, ct);
            await erasure.EraseAsync(subject, ct);
            // Also acknowledged when nothing was stored: the subject is erased either way.
            return Results.NoContent();
        }).DisableAntiforgery();
    }
}
