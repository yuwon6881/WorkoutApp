using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// Validates the Fitness Account's notice that a central account was deleted.
public interface IAccountDeletionNoticeValidator
{
    /// Returns the deleted central subject, or throws a 4xx/503 DomainException.
    Task<string> ValidateAsync(string token, CancellationToken ct);
}

/// Erases everything Workout holds for a central account after Fitness Account deletes it.
///
/// Every user-owned table cascades from <see cref="AppUser"/> in the schema, so deleting the user
/// row removes programs, workouts, sets, progress, imports, devices, push, AI and integration rows
/// at once. What the schema cannot reach is handled first: the Google Health grant is revoked at
/// Google, and an approved watch pairing (which names its account without a foreign key, because it
/// starts out unowned) is deleted explicitly.
public sealed class AccountErasureService(AppDb db, GoogleHealthService googleHealth)
{
    /// Returns false when no account exists for the subject, which is already the erased state.
    public async Task<bool> EraseAsync(string identitySubject, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.IdentitySubject == identitySubject, ct);
        if (user is null) return false;
        db.CurrentUser = user.Id;
        db.MaintenanceAccess = true;

        // Sign every browser and watch out first so nothing new is written while erasure runs.
        await db.Sessions.Where(session => session.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.WatchDevices.Where(device => device.UserId == user.Id).ExecuteDeleteAsync(ct);
        await googleHealth.DisconnectAsync(user.Id, ct);
        await db.WatchPairings.Where(pairing => pairing.ApprovedUserId == user.Id).ExecuteDeleteAsync(ct);
        await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync(ct);
        return true;
    }
}
