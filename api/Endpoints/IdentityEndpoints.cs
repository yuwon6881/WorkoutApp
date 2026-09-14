using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Endpoints;

public sealed record IdentityAttachment(Guid LocalUserId, string Subject);

public static class IdentityEndpoints
{
    public static void MapIdentityOperations(this WebApplication app)
    {
        app.MapPost("/internal/identity/attach", async (IdentityAttachment input, HttpRequest request, AppDb db, IConfiguration config, CancellationToken ct) =>
        {
            RequireToken(request, config);
            Validation.Require(!string.IsNullOrWhiteSpace(input.Subject) && input.Subject.Length <= 200, "A central identity subject is required.", 400);
            var user = await db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(item => item.Id == input.LocalUserId, ct);
            Validation.Require(user is not null, "The local Workout user was not found; no history was changed.", 404);
            var subject = input.Subject.Trim();
            Validation.Require(user!.IdentitySubject is null || user.IdentitySubject == subject, "The local subject mapping is immutable once attached.", 409);
            var collision = await db.Users.IgnoreQueryFilters().AnyAsync(item => item.IdentitySubject == subject && item.Id != input.LocalUserId, ct);
            Validation.Require(!collision, "That central subject is already attached to another Workout user.", 409);
            user.IdentitySubject = subject;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { user.Id, subject = user.IdentitySubject });
        });

        app.MapPost("/internal/identity/disable-legacy", async (HttpRequest request, AppDb db, IConfiguration config, CancellationToken ct) =>
        {
            RequireToken(request, config);
            Validation.Require(config.GetValue("Identity:AllowLegacyCutover", false), "Legacy identity cutover is not enabled for this deployment.", 409);
            await db.Sessions.IgnoreQueryFilters().ExecuteDeleteAsync(ct);
            await db.Users.IgnoreQueryFilters().ExecuteUpdateAsync(update => update.SetProperty(user => user.PasswordHash, ""), ct);
            return Results.NoContent();
        });
    }

    private static void RequireToken(HttpRequest request, IConfiguration config)
    {
        var expected = config["Identity:AttachToken"];
        var supplied = request.Headers["X-Identity-Attach-Token"].ToString();
        Validation.Require(!string.IsNullOrWhiteSpace(expected) && FixedEquals(expected, supplied), "Identity operations authentication required.", 401);
    }

    private static bool FixedEquals(string expected, string supplied)
        => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(supplied));
}
