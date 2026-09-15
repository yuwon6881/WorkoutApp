using System.Security.Cryptography;
using System.Text;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed class AuthService(AppDb db)
{
    public const string Cookie = "workout-session";

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<string> CreateSession(Guid user, CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.Sessions.Add(new AuthSession { UserId = user, Hash = Hash(token), Expires = DateTime.UtcNow.AddDays(30) });
        await db.SaveChangesAsync(ct);
        return token;
    }
}
