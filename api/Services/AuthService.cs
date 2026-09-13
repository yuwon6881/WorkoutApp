using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed class AuthService(AppDb db, IConfiguration config)
{
    public const string Cookie = "workout-session";
    private static readonly PasswordHasher<string> Hasher = new();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<AppUser> Register(string username, string password, CancellationToken ct)
    {
        username = username.Trim().ToLowerInvariant();
        Validation.Require(username.Length is >= 3 and <= 80 && username.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.' or '@'), "Use 3-80 letters, digits, or . _ - @ for your username.");
        ValidatePassword(password);
        await using var gate = await MutationLock.Acquire(db, null, ct);
        var max = config.GetValue("Auth:MaxUsers", 2);
        Validation.Require(max is >= 1 and <= 100, "Invalid registration configuration.", 503);
        var users = await db.Users.ToListAsync(ct);
        Validation.Require(!users.Any(u => u.Username == username), "Username is unavailable.", 409);
        var slot = Enumerable.Range(1, max).FirstOrDefault(s => users.All(u => u.Slot != s));
        Validation.Require(slot != 0, "Registration is closed. The user limit has been reached.", 409);
        var user = new AppUser { Username = username, Slot = slot, PasswordHash = Hasher.HashPassword(username, password) };
        db.Users.Add(user); await db.SaveChangesAsync(ct); await gate.Commit(ct); return user;
    }

    public async Task<AppUser> Login(string username, string password, CancellationToken ct)
    {
        Validation.Require(password.Length <= 256, "Invalid username or password.", 401);
        var user = await db.Users.SingleOrDefaultAsync(x => x.Username == username.Trim().ToLowerInvariant(), ct);
        // Equal-cost verification makes an unknown username less useful as an oracle.
        var hash = user?.PasswordHash ?? DummyHash;
        var result = Hasher.VerifyHashedPassword(username, hash, password);
        Validation.Require(user != null && result != PasswordVerificationResult.Failed, "Invalid username or password.", 401);
        return user!;
    }
    private static readonly string DummyHash = Hasher.HashPassword("dummy", Convert.ToHexString(RandomNumberGenerator.GetBytes(32)));

    public async Task<string> CreateSession(Guid user, CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.Sessions.Add(new AuthSession { UserId = user, Hash = Hash(token), Expires = DateTime.UtcNow.AddDays(30) });
        await db.SaveChangesAsync(ct); return token;
    }

    public async Task ChangePassword(Guid id, string oldPassword, string newPassword, CancellationToken ct)
    {
        ValidatePassword(newPassword);
        await using var gate = await MutationLock.Acquire(db, id, ct);
        var user = await db.Users.SingleAsync(x => x.Id == id, ct);
        Validation.Require(Hasher.VerifyHashedPassword(user.Username, user.PasswordHash, oldPassword) != PasswordVerificationResult.Failed, "Current password is incorrect.", 400);
        user.PasswordHash = Hasher.HashPassword(user.Username, newPassword);
        db.Sessions.RemoveRange(await db.Sessions.Where(x => x.UserId == id).ToListAsync(ct));
        await db.SaveChangesAsync(ct); await gate.Commit(ct);
    }
    private static void ValidatePassword(string password) => Validation.Require(password.Length is >= 12 and <= 256, "Use a password of 12-256 characters.");
}
