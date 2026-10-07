using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Endpoints;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class AccountErasureTests
{
    private const string Issuer = "https://fitness-account.example";
    private const string ClientId = "workout-api";

    /// Names a user without a foreign key because a pairing starts out unowned; erasure deletes it explicitly.
    private static readonly HashSet<string> ExplicitlyErased = [$"{nameof(WatchPairing)}.{nameof(WatchPairing.ApprovedUserId)}"];

    [Fact]
    public async Task A_deletion_notice_erases_every_owned_row_and_the_google_grant()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"workout-erasure-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new ErasureFactory(dbPath);
            Guid doomed, survivor;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                doomed = await SeedAccount(db, "doomed-subject");
                survivor = await SeedAccount(db, "surviving-subject");
            }
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            // No session cookie and no browser origin: the signed notice is the only credential.
            var rejected = await client.PostAsync(AccountDeletionEndpoints.Path, Notice("forged"));
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
            using (var scope = factory.Services.CreateScope())
                Assert.True(await scope.ServiceProvider.GetRequiredService<AppDb>().Users.AnyAsync(user => user.Id == doomed));

            var erased = await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:doomed-subject"));

            Assert.Equal(HttpStatusCode.NoContent, erased.StatusCode);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                Assert.False(await db.Users.AnyAsync(user => user.Id == doomed));
                Assert.All(await RowsOwnedBy(db, doomed), table => Assert.True(table.Value == 0, $"{table.Key} still holds {table.Value} row(s)."));
                var kept = await RowsOwnedBy(db, survivor);
                Assert.True(kept.Count(table => table.Value > 0) >= 8, "The surviving account lost rows it owns.");
            }
            Assert.Contains(factory.Google.Requests, url => url.StartsWith("https://oauth2.googleapis.com/revoke", StringComparison.Ordinal));

            // A retried notice for an already-erased subject is acknowledged again.
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:doomed-subject"))).StatusCode);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public void Every_user_owned_table_cascades_from_the_user_row()
    {
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        var userType = db.Model.FindEntityType(typeof(AppUser))!;
        foreach (var entity in db.Model.GetEntityTypes().Where(entity => !entity.IsOwned() && entity.ClrType != typeof(AppUser)))
        {
            foreach (var property in entity.GetProperties().Where(IsUserReference))
            {
                if (ExplicitlyErased.Contains($"{entity.ClrType.Name}.{property.Name}")) continue;
                var cascades = property.GetContainingForeignKeys().Any(key =>
                    key.PrincipalEntityType == userType && key.DeleteBehavior == DeleteBehavior.Cascade);
                Assert.True(cascades, $"{entity.ClrType.Name}.{property.Name} names a user but does not cascade from Users; account erasure would leave it behind.");
            }
        }
    }

    [Fact]
    public void The_applied_migrations_carry_the_same_cascades_as_the_model()
    {
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql("Host=unused;Database=unused").Options);
        Assert.False(db.Database.HasPendingModelChanges(), "The model differs from the migration snapshot.");
    }

    [Fact]
    public void A_genuine_deletion_notice_yields_its_subject()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "signing" };

        Assert.Equal("subject-1", SharedAccessTokenService.ReadAccountDeletionSubject(Sign(key), ClientId, Issuer + "/", [key]));
    }

    [Theory]
    [InlineData("identity-token")]
    [InlineData("nonce")]
    [InlineData("no-event")]
    [InlineData("other-audience")]
    [InlineData("other-issuer")]
    [InlineData("expired")]
    [InlineData("other-key")]
    public void Anything_but_a_genuine_deletion_notice_is_rejected(string variant)
    {
        using var rsa = RSA.Create(2048);
        using var otherRsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "signing" };
        var token = variant switch
        {
            "identity-token" => Sign(key, type: "JWT"),
            "nonce" => Sign(key, extra: new Dictionary<string, object> { ["nonce"] = "n" }),
            "no-event" => Sign(key, events: false),
            "other-audience" => Sign(key, audience: "nutrition-api"),
            "other-issuer" => Sign(key, issuer: "https://attacker.example"),
            "expired" => Sign(key, expires: DateTime.UtcNow.AddMinutes(-5)),
            _ => Sign(new RsaSecurityKey(otherRsa) { KeyId = "signing" })
        };

        Assert.ThrowsAny<SecurityTokenException>(() =>
            SharedAccessTokenService.ReadAccountDeletionSubject(token, ClientId, Issuer, [key]));
    }

    private static bool IsUserReference(IProperty property)
        => (property.ClrType == typeof(Guid) || property.ClrType == typeof(Guid?)) &&
           property.Name.EndsWith("UserId", StringComparison.Ordinal);

    private static string Sign(SecurityKey key, string type = SharedAccessTokenService.AccountDeletionTokenType,
        string audience = ClientId, string issuer = Issuer, bool events = true, DateTime? expires = null,
        Dictionary<string, object>? extra = null)
    {
        var claims = new Dictionary<string, object>(extra ?? []);
        if (events) claims["events"] = new Dictionary<string, object> { [SharedAccessTokenService.AccountDeletionEvent] = new Dictionary<string, object>() };
        var expiry = expires ?? DateTime.UtcNow.AddMinutes(5);
        return new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            TokenType = type,
            IssuedAt = expiry.AddMinutes(-10),
            NotBefore = expiry.AddMinutes(-10),
            Expires = expiry,
            Subject = new ClaimsIdentity([new Claim("sub", "subject-1"), new Claim("jti", Guid.NewGuid().ToString("N"))]),
            Claims = claims,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256)
        });
    }

    private static FormUrlEncodedContent Notice(string token) => new([new KeyValuePair<string, string>("deletion_token", token)]);

    private static async Task<Guid> SeedAccount(AppDb db, string subject)
    {
        var user = new AppUser { Id = Guid.NewGuid(), DisplayName = subject, IdentitySubject = subject };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        db.MaintenanceAccess = true;
        var now = DateTime.UtcNow;
        var session = new WorkoutSession { Id = Guid.NewGuid(), UserId = user.Id, Name = "Push", FinishedAt = now };
        var exercise = new SessionExercise { Id = Guid.NewGuid(), UserId = user.Id, SessionId = session.Id, NameSnapshot = "Bench press" };
        db.Sessions.Add(new AuthSession { UserId = user.Id, Hash = Guid.NewGuid().ToString("N"), Expires = now.AddDays(1) });
        db.Programs.Add(new TrainingProgram { Id = Guid.NewGuid(), UserId = user.Id, Name = "Program" });
        db.CustomExercises.Add(new CustomExercise { Id = Guid.NewGuid(), UserId = user.Id, Name = $"Custom {subject}" });
        db.Workouts.Add(session);
        db.SessionExercises.Add(exercise);
        db.Sets.Add(new CompletedSet { Id = Guid.NewGuid(), UserId = user.Id, SessionExerciseId = exercise.Id, WeightKg = 60, Reps = 8, Done = true });
        db.Receipts.Add(new MutationReceipt { Id = Guid.NewGuid(), UserId = user.Id, Operation = "test", RequestHash = "hash" });
        db.Usage.Add(new AiUsage { UserId = user.Id, Date = DateOnly.FromDateTime(now) });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection { UserId = user.Id, GoogleIdHash = subject, EncryptedRefreshToken = "encrypted" });
        db.WorkoutPushDevices.Add(new WorkoutPushDevice { Id = Guid.NewGuid(), UserId = user.Id, DeviceId = "phone", FcmToken = "token" });
        db.WatchDevices.Add(new WatchDevice { Id = Guid.NewGuid(), UserId = user.Id, DeviceId = $"watch-{subject}", TokenHash = $"hash-{subject}", ExpiresAt = now.AddDays(1) });
        db.WatchPairings.Add(new WatchPairing { DeviceId = $"watch-{subject}", PairingCodeHash = "code", DeviceTokenHash = "token", ExpiresAt = now.AddMinutes(5), ApprovedAt = now, ApprovedUserId = user.Id });
        db.AiConversations.Add(new AiConversation { UserId = user.Id });
        await db.SaveChangesAsync();
        return user.Id;
    }

    /// Counts, for every mapped table with a user column, the rows that still name this user.
    private static async Task<Dictionary<string, long>> RowsOwnedBy(AppDb db, Guid userId)
    {
        var counts = new Dictionary<string, long>();
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        foreach (var entity in db.Model.GetEntityTypes().Where(entity => !entity.IsOwned()))
        {
            foreach (var property in entity.GetProperties().Where(IsUserReference))
            {
                await using var command = connection.CreateCommand();
                command.CommandText = $"SELECT COUNT(*) FROM \"{entity.GetTableName()}\" WHERE \"{property.GetColumnName()}\" = $id";
                var parameter = command.CreateParameter();
                parameter.ParameterName = "$id";
                parameter.Value = userId.ToString().ToUpperInvariant();
                command.Parameters.Add(parameter);
                counts[$"{entity.GetTableName()}.{property.Name}"] = Convert.ToInt64(await command.ExecuteScalarAsync());
            }
        }
        return counts;
    }

    private sealed class ErasureFactory(string dbPath) : WebApplicationFactory<Program>
    {
        public RecordingHandler Google { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost"
            }));
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IAccountDeletionNoticeValidator, PrefixValidator>();
                services.AddSingleton<IIntegrationKms, PlainKms>();
                services.AddHttpClient<GoogleHealthService>().ConfigurePrimaryHttpMessageHandler(() => Google);
            });
        }
    }

    private sealed class PrefixValidator : IAccountDeletionNoticeValidator
    {
        public Task<string> ValidateAsync(string token, CancellationToken ct)
            => token.StartsWith("valid:", StringComparison.Ordinal)
                ? Task.FromResult(token["valid:".Length..])
                : throw new DomainException("The account deletion notice is invalid.", 401);
    }

    private sealed class PlainKms : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult("google-refresh-token");
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public ConcurrentQueue<string> Requests { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Enqueue(request.RequestUri!.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }
}
