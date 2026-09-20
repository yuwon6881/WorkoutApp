using System.Net;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class IntegrationTokenServiceTests
{
    [Fact]
    public async Task Generic_exchange_rejection_does_not_revoke_a_connection_that_central_confirms_active()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var connectionId = Guid.NewGuid();
        harness.Db.IntegrationGrants.Add(ActiveGrant(user.Id, connectionId, 5));
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(request => request.RequestUri!.AbsolutePath == "/connect/token"
            ? new HttpResponseMessage(HttpStatusCode.BadRequest)
            : Json(HttpStatusCode.OK, "{\"status\":\"active\",\"generation\":5}"));
        var service = CreateService(harness.Db, handler, new StubKms());

        Assert.Null(await service.AccessToken("nutrition", "nutrition.training_context.read", CancellationToken.None));

        var stored = await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync();
        Assert.Equal("active", stored.Status);
        Assert.Equal(connectionId, stored.CentralConnectionId);
        Assert.Equal(2, handler.Calls);
        Assert.DoesNotContain("refresh_token", handler.Bodies[0]);
    }

    [Fact]
    public async Task Successful_short_lived_token_exchange_is_cached_without_rotating_the_connection_id()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var grant = ActiveGrant(user.Id, Guid.NewGuid(), 7);
        harness.Db.IntegrationGrants.Add(grant);
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => Json(HttpStatusCode.OK, "{\"access_token\":\"access-1\",\"expires_in\":300}"));
        var service = CreateService(harness.Db, handler, new StubKms());

        var first = await service.AccessToken("nutrition", "nutrition.training_context.read", CancellationToken.None);
        var second = await service.AccessToken("nutrition", "nutrition.training_context.read", CancellationToken.None);

        Assert.Equal("access-1", first);
        Assert.Equal(first, second);
        Assert.Equal(1, handler.Calls);
        Assert.Contains($"connection_id={grant.CentralConnectionId:D}", handler.Bodies[0]);
        Assert.DoesNotContain("refresh_token", handler.Bodies[0]);
        Assert.Equal("active", (await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Status_outage_keeps_local_connection_active_and_reports_temporary_unavailability()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        harness.Db.IntegrationGrants.Add(ActiveGrant(user.Id, Guid.NewGuid(), 8));
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var service = CreateService(harness.Db, handler, new StubKms());

        Assert.Equal("temporary_unavailable", await service.ConnectionState("nutrition", CancellationToken.None));
        Assert.Equal("active", (await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Legacy_connection_without_durable_identity_requires_explicit_upgrade()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        harness.Db.IntegrationGrants.Add(new IntegrationGrant { UserId = user.Id, Peer = "nutrition", Status = "active", EncryptedRefreshToken = "legacy" });
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => throw new InvalidOperationException("Status must not be guessed for a legacy grant."));
        var service = CreateService(harness.Db, handler, new StubKms());

        Assert.Equal("upgrade_required", await service.ConnectionState("nutrition", CancellationToken.None));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Confirmed_revocation_marks_reconnect_required_without_deleting_consent_history()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var grant = ActiveGrant(user.Id, Guid.NewGuid(), 3);
        harness.Db.IntegrationGrants.Add(grant);
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(request => request.RequestUri!.AbsolutePath == "/connect/token"
            ? new HttpResponseMessage(HttpStatusCode.BadRequest)
            : Json(HttpStatusCode.OK, "{\"status\":\"revoked\",\"generation\":3}"));
        var service = CreateService(harness.Db, handler, new StubKms());

        Assert.Null(await service.AccessToken("nutrition", "nutrition.training_context.read", CancellationToken.None));

        var stored = await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync();
        Assert.Equal("reconnect_required", stored.Status);
        Assert.Equal(grant.CentralConnectionId, stored.CentralConnectionId);
    }

    [Fact]
    public async Task Disconnect_keeps_legacy_grant_when_its_credential_cannot_be_decrypted()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var grant = new IntegrationGrant
        {
            UserId = user.Id,
            Peer = "nutrition",
            Status = "active",
            EncryptedRefreshToken = "cannot-decrypt"
        };
        harness.Db.IntegrationGrants.Add(grant);
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => throw new InvalidOperationException("The central service must not be called with an unreadable credential."));
        var service = CreateService(harness.Db, handler, new StubKms(decryptFailure: true));

        var error = await Assert.ThrowsAsync<DomainException>(() => service.RevokeAndPurge("nutrition", CancellationToken.None));

        Assert.Equal(503, error.Status);
        Assert.Single(await harness.Db.IntegrationGrants.AsNoTracking().ToListAsync());
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Disconnect_keeps_durable_grant_when_central_revoke_is_unavailable()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        harness.Db.IntegrationGrants.Add(ActiveGrant(user.Id, Guid.NewGuid(), 2));
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var service = CreateService(harness.Db, handler, new StubKms());

        var error = await Assert.ThrowsAsync<DomainException>(() => service.RevokeAndPurge("nutrition", CancellationToken.None));

        Assert.Equal(503, error.Status);
        Assert.Equal("active", (await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Successful_disconnect_revokes_centrally_before_persisting_local_tombstone()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var grant = ActiveGrant(user.Id, Guid.NewGuid(), 2);
        harness.Db.IntegrationGrants.Add(grant);
        await harness.Db.SaveChangesAsync();
        var handler = new RouteHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        var service = CreateService(harness.Db, handler, new StubKms());

        await service.RevokeAndPurge("nutrition", CancellationToken.None);

        var tombstone = await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync();
        Assert.Equal("disconnected", tombstone.Status);
        Assert.Equal(grant.CentralConnectionId, tombstone.CentralConnectionId);
        Assert.Equal(grant.CentralConnectionGeneration, tombstone.CentralConnectionGeneration);
        Assert.Empty(tombstone.EncryptedRefreshToken);
        Assert.Equal($"/internal/integrations/connections/{grant.CentralConnectionId:D}/revoke", handler.Paths.Single());
    }

    [Fact]
    public async Task Delayed_callback_cannot_reactivate_local_grant_after_disconnect()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var handler = new RouteHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        var service = CreateService(harness.Db, handler, new StubKms());
        var callbackRevision = await service.BeginConnectionAttempt(CancellationToken.None);

        await service.RevokeAndPurge("nutrition", CancellationToken.None);
        var stored = await service.StoreDurableConnection(user.Id, Guid.NewGuid(), 1,
            "nutrition.training_context.read", callbackRevision, CancellationToken.None);

        Assert.False(stored);
        var tombstone = await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync();
        Assert.Equal("disconnected", tombstone.Status);
        Assert.Null(tombstone.CentralConnectionId);
        Assert.Null(tombstone.CentralConnectionGeneration);
        Assert.Empty(tombstone.EncryptedRefreshToken);
    }

    [Fact]
    public async Task Reconnect_attempt_uses_new_revision_after_disconnect_tombstone()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        var handler = new RouteHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        var service = CreateService(harness.Db, handler, new StubKms());
        var firstRevision = await service.BeginConnectionAttempt(CancellationToken.None);
        await service.RevokeAndPurge("nutrition", CancellationToken.None);
        var nextRevision = await service.BeginConnectionAttempt(CancellationToken.None);

        Assert.True(nextRevision > firstRevision);
        Assert.True(await service.StoreDurableConnection(user.Id, Guid.NewGuid(), 1,
            "nutrition.training_context.read", nextRevision, CancellationToken.None));
        Assert.Equal("active", (await harness.Db.IntegrationGrants.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Disconnected_legacy_tombstone_is_not_misreported_as_upgrade_required()
    {
        await using var harness = await Harness.Create();
        var user = await harness.SignIn();
        harness.Db.IntegrationGrants.Add(new IntegrationGrant
        {
            UserId = user.Id,
            Peer = "nutrition",
            Status = "disconnected",
            RevokedAt = DateTime.UtcNow
        });
        await harness.Db.SaveChangesAsync();
        var service = CreateService(harness.Db, new RouteHandler(_ => throw new InvalidOperationException()), new StubKms());

        Assert.Equal("disconnected", await service.ConnectionState("nutrition", CancellationToken.None));
    }

    private static IntegrationGrant ActiveGrant(Guid userId, Guid connectionId, long generation)
        => new()
        {
            UserId = userId,
            Peer = "nutrition",
            Status = "active",
            CentralConnectionId = connectionId,
            CentralConnectionGeneration = generation,
            ScopesJson = "[\"nutrition.training_context.read\"]"
        };

    private static IntegrationTokenService CreateService(AppDb db, RouteHandler handler, IIntegrationKms kms)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Identity:Authority"] = "https://fitness.example",
            ["Identity:ClientId"] = "workout-api",
            ["Identity:ClientSecret"] = "workout-secret"
        }).Build();
        var central = new FitnessConnectionClient(new SingleClientFactory(handler), config);
        var grant = db.IntegrationGrants.AsNoTracking().SingleOrDefault(x => x.Peer == "nutrition");
        var subject = db.Users.AsNoTracking().Select(x => x.IdentitySubject).FirstOrDefault() ?? "";
        var validator = new StubTokenValidator(subject, grant?.CentralConnectionId, grant?.CentralConnectionGeneration);
        return new IntegrationTokenService(db, central, validator, kms, NullLogger<IntegrationTokenService>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string value)
        => new(status) { Content = new StringContent(value) };

    private sealed class StubTokenValidator(string subject, Guid? connectionId, long? generation) : ISharedAccessTokenValidator
    {
        public Task<ValidatedAccessToken> RequireAccessToken(string accessToken, string requiredScope, CancellationToken ct)
            => Task.FromResult(new ValidatedAccessToken(subject, "", new HashSet<string>([requiredScope], StringComparer.Ordinal),
                DateTime.UtcNow.AddMinutes(5), connectionId, generation));
    }

    private sealed class StubKms(bool decryptFailure = false) : IIntegrationKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct)
            => decryptFailure ? Task.FromException<string>(new CryptographicException("invalid ciphertext")) : Task.FromResult(ciphertext);
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RouteHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public List<string> Paths { get; } = [];
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Paths.Add(request.RequestUri?.AbsolutePath ?? "");
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return respond(request);
        }
    }
}
