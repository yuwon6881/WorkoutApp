using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Issues short-lived peer access tokens from durable FitnessAccount consent. Connection IDs
/// are not consumed during issuance, so cancellation and concurrent callers cannot rotate consent.
public sealed class IntegrationTokenService(
    AppDb db,
    FitnessConnectionClient central,
    ISharedAccessTokenValidator tokens,
    IIntegrationKms kms,
    ILogger<IntegrationTokenService> logger)
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ExchangeGates = new(StringComparer.Ordinal);
    private static readonly MemoryCache AccessTokens = new(new MemoryCacheOptions { SizeLimit = 512 });
    private static readonly TimeSpan CentralTimeout = TimeSpan.FromSeconds(10);

    public async Task<int> BeginConnectionAttempt(CancellationToken ct)
    {
        var userId = db.CurrentUser;
        if (userId is null) throw new DomainException("Sign in before connecting Nutrition.", 401);

        var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == "nutrition", ct);
        if (grant is not null) return grant.Revision;

        grant = new IntegrationGrant { UserId = userId.Value, Peer = "nutrition", Status = "disconnected" };
        db.IntegrationGrants.Add(grant);
        try
        {
            await db.SaveChangesAsync(ct);
            return grant.Revision;
        }
        catch (DbUpdateException)
        {
            // Another connect request may have created the one-per-user row at the same time.
            db.Entry(grant).State = EntityState.Detached;
            var existing = await db.IntegrationGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Peer == "nutrition", ct);
            if (existing is null) throw;
            return existing.Revision;
        }
    }

    public async Task<bool> StoreDurableConnection(Guid userId, Guid connectionId, long generation, string scope,
        int expectedRevision, CancellationToken ct)
    {
        // One conditional database update makes the callback compare-and-swap atomic with an
        // explicit disconnect. A disconnect increments Revision, so a callback that started
        // before it cannot recreate an active local grant after the revoke finishes.
        var now = DateTime.UtcNow;
        var updated = await db.IntegrationGrants
            .Where(x => x.UserId == userId && x.Peer == "nutrition" && x.Revision == expectedRevision
                && (x.CentralConnectionGeneration == null || x.CentralConnectionGeneration <= generation
                    || (x.Status == "active" && x.CentralConnectionId == connectionId && x.CentralConnectionGeneration < generation)))
            .ExecuteUpdateAsync(update => update
                .SetProperty(x => x.Status, "active")
                .SetProperty(x => x.ScopesJson, JsonSerializer.Serialize(new[] { scope }, Json.Options))
                .SetProperty(x => x.CentralConnectionId, connectionId)
                .SetProperty(x => x.CentralConnectionGeneration, generation)
                // FitnessAccount's consent flow replaces the older authorization. Never make
                // successful reconsent depend on decrypting an obsolete rotating token.
                .SetProperty(x => x.EncryptedRefreshToken, "")
                .SetProperty(x => x.GrantedAt, now)
                .SetProperty(x => x.RevokedAt, (DateTime?)null)
                .SetProperty(x => x.Revision, x => x.Revision + 1), ct);
        return updated == 1;
    }

    public async Task<string?> AccessToken(string peer, string requiredScope, CancellationToken ct)
    {
        var userId = db.CurrentUser;
        if (userId is null) return null;
        var grantSnapshot = await db.IntegrationGrants.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
        if (!HasDurableConnection(grantSnapshot)) return null;

        var connectionId = grantSnapshot!.CentralConnectionId!.Value;
        var generation = grantSnapshot.CentralConnectionGeneration!.Value;
        var key = CacheKey(userId.Value, peer, connectionId, generation, requiredScope);
        if (TryCached(key, grantSnapshot.Revision, out var cached)) return cached;
        var gate = ExchangeGates.GetOrAdd(key, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var grant = await db.IntegrationGrants.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
            if (!Matches(grant, connectionId, generation)) { AccessTokens.Remove(key); return null; }
            if (TryCached(key, grant!.Revision, out cached)) return cached;

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(CentralTimeout);
            FitnessConnectionTokenExchange exchange;
            try { exchange = await central.Exchange(connectionId, timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Fitness Account token exchange timed out for connection {ConnectionId}, generation {Generation}.", connectionId, generation);
                return null;
            }
            catch (HttpRequestException ex)
            {
                logger.LogWarning("Fitness Account token exchange failed for connection {ConnectionId}, generation {Generation}: {FailureType}.",
                    connectionId, generation, ex.GetType().Name);
                return null;
            }

            if (exchange.StatusCode != HttpStatusCode.OK)
            {
                await ReconcileRejectedExchange(grant!, connectionId, generation, timeout.Token);
                logger.LogWarning("Fitness Account declined token exchange for connection {ConnectionId}, generation {Generation}, status {StatusCode}.",
                    connectionId, generation, (int)exchange.StatusCode);
                return null;
            }
            if (string.IsNullOrWhiteSpace(exchange.AccessToken) || exchange.ExpiresIn is not > 0) return null;

            var identitySubject = await db.Users.AsNoTracking().Where(x => x.Id == userId)
                .Select(x => x.IdentitySubject).SingleOrDefaultAsync(ct);
            ValidatedAccessToken validated;
            try { validated = await tokens.RequireAccessToken(exchange.AccessToken, requiredScope, ct); }
            catch (DomainException ex)
            {
                logger.LogWarning("Fitness Account issued an unusable access token for connection {ConnectionId}, generation {Generation}: {FailureType}.",
                    connectionId, generation, ex.GetType().Name);
                return null;
            }
            if (!string.Equals(validated.Subject, identitySubject, StringComparison.Ordinal)
                || validated.FitnessConnectionId != connectionId
                || validated.FitnessConnectionGeneration != generation)
            {
                logger.LogWarning("Fitness Account token claims did not match connection {ConnectionId}, generation {Generation}.", connectionId, generation);
                return null;
            }

            // A central-first disconnect may have completed while token issuance was in flight.
            // Recheck local generation before caching or returning the token.
            var currentGrant = await db.IntegrationGrants.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
            if (!Matches(currentGrant, connectionId, generation)) { AccessTokens.Remove(key); return null; }

            var expiresAt = DateTime.UtcNow.AddSeconds(exchange.ExpiresIn.Value);
            if (exchange.ExpiresIn.Value > 60)
            {
                AccessTokens.Set(key, new CachedAccessToken(exchange.AccessToken, currentGrant!.Revision, expiresAt), new MemoryCacheEntryOptions
                {
                    Size = 1,
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(Math.Max(1, exchange.ExpiresIn.Value - 60))
                });
            }
            return exchange.AccessToken;
        }
        catch (DomainException ex)
        {
            logger.LogWarning("Fitness Account token acquisition is temporarily unavailable for peer {Peer}: {FailureType}.", peer, ex.GetType().Name);
            return null;
        }
        catch (JsonException ex)
        {
            logger.LogWarning("Fitness Account token acquisition returned invalid data for peer {Peer}: {FailureType}.", peer, ex.GetType().Name);
            return null;
        }
        finally { gate.Release(); }
    }

    public async Task<string> ConnectionState(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null) return "disconnected";
        if (grant.Status == "disconnected") return "disconnected";
        if (!HasDurableConnection(grant)) return "upgrade_required";
        if (grant.Status == "reconnect_required") return "reconnect_required";
        if (grant.Status != "active") return "disconnected";

        var connectionId = grant.CentralConnectionId!.Value;
        var generation = grant.CentralConnectionGeneration!.Value;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(CentralTimeout);
        FitnessConnectionStatus status;
        try { status = await central.GetStatus(connectionId, timeout.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Fitness Account status check timed out for connection {ConnectionId}, generation {Generation}.", connectionId, generation);
            return "temporary_unavailable";
        }
        catch (Exception ex) when (ex is HttpRequestException or DomainException)
        {
            logger.LogWarning("Fitness Account status check failed for connection {ConnectionId}, generation {Generation}: {FailureType}.",
                connectionId, generation, ex.GetType().Name);
            return "temporary_unavailable";
        }

        if (status.Status == "active" && status.Generation == generation) return "connected";
        await MarkReconnectRequired(grant, connectionId, generation, ct);
        return "reconnect_required";
    }

    /// Checks central consent on every incoming shared-data request. No positive result is cached.
    public async Task ValidateIncoming(ValidatedAccessToken token, CancellationToken ct)
    {
        Validation.Require(token.FitnessConnectionId is not null && token.FitnessConnectionGeneration is not null,
            "The shared access token is not bound to a current Fitness connection.", 401);
        var connectionId = token.FitnessConnectionId!.Value;
        var generation = token.FitnessConnectionGeneration!.Value;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(CentralTimeout);
        bool active;
        try { active = await central.ValidateIncoming(connectionId, generation, timeout.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Fitness Account validation timed out for incoming connection {ConnectionId}, generation {Generation}.", connectionId, generation);
            throw new DomainException("Fitness Account cannot verify this shared connection right now.", 503);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Fitness Account validation failed for incoming connection {ConnectionId}, generation {Generation}: {FailureType}.",
                connectionId, generation, ex.GetType().Name);
            throw new DomainException("Fitness Account cannot verify this shared connection right now.", 503);
        }
        Validation.Require(active, "This shared connection has been revoked or replaced.", 401);
    }

    public async Task RevokeAndPurge(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null) return;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(CentralTimeout);
        if (grant.CentralConnectionId is { } connectionId)
        {
            try { await central.Revoke(connectionId, timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Fitness Account revocation timed out for connection {ConnectionId}.", connectionId);
                throw new DomainException("Fitness Account could not confirm disconnection. Try again.", 503);
            }
            catch (Exception ex) when (ex is HttpRequestException or DomainException)
            {
                logger.LogWarning("Fitness Account revocation failed for connection {ConnectionId}: {FailureType}.", connectionId, ex.GetType().Name);
                throw new DomainException("Fitness Account could not confirm disconnection. Try again.", 503);
            }
            AccessTokens.Remove(CacheKey(grant.UserId, peer, connectionId, grant.CentralConnectionGeneration ?? 0, "nutrition.training_context.read"));
        }
        if (!string.IsNullOrWhiteSpace(grant.EncryptedRefreshToken))
        {
            string? refresh;
            try { refresh = await kms.DecryptAsync(grant.EncryptedRefreshToken, timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Legacy Fitness Account credential decryption timed out for connection owned by user {UserId}.", grant.UserId);
                throw new DomainException("The previous Nutrition connection could not be safely removed. Try again.", 503);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("Legacy Fitness Account credential decryption failed for connection owned by user {UserId}: {FailureType}.",
                    grant.UserId, ex.GetType().Name);
                throw new DomainException("The previous Nutrition connection could not be safely removed. Try again.", 503);
            }
            if (string.IsNullOrWhiteSpace(refresh))
                throw new DomainException("The previous Nutrition connection could not be safely removed. Try again.", 503);
            try { await central.RevokeLegacyRefreshToken(refresh, timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Legacy Fitness Account revocation timed out for connection owned by user {UserId}.", grant.UserId);
                throw new DomainException("Fitness Account could not confirm disconnection. Try again.", 503);
            }
            catch (Exception ex) when (ex is HttpRequestException or DomainException)
            {
                logger.LogWarning("Legacy Fitness Account revocation failed for connection owned by user {UserId}: {FailureType}.",
                    grant.UserId, ex.GetType().Name);
                throw new DomainException("Fitness Account could not confirm disconnection. Try again.", 503);
            }
        }
        var revokedAt = DateTime.UtcNow;
        await db.IntegrationGrants
            .Where(x => x.UserId == grant.UserId && x.Peer == peer)
            .ExecuteUpdateAsync(update => update
                .SetProperty(x => x.Status, "disconnected")
                .SetProperty(x => x.ScopesJson, "[]")
                .SetProperty(x => x.EncryptedRefreshToken, "")
                .SetProperty(x => x.RevokedAt, revokedAt)
                .SetProperty(x => x.Revision, x => x.Revision + 1), ct);
        db.Entry(grant).State = EntityState.Detached;
    }

    private async Task ReconcileRejectedExchange(IntegrationGrant grant, Guid connectionId, long generation, CancellationToken ct)
    {
        FitnessConnectionStatus status;
        try { status = await central.GetStatus(connectionId, ct); }
        catch (Exception ex) when (ex is HttpRequestException or DomainException or OperationCanceledException)
        {
            logger.LogWarning("Could not confirm why Fitness Account declined connection {ConnectionId}, generation {Generation}: {FailureType}.",
                connectionId, generation, ex.GetType().Name);
            return;
        }
        if (status.Status == "active" && status.Generation == generation) return;
        await MarkReconnectRequired(grant, connectionId, generation, ct);
    }

    private async Task MarkReconnectRequired(IntegrationGrant snapshot, Guid connectionId, long generation, CancellationToken ct)
    {
        var updated = await db.IntegrationGrants
            .Where(x => x.Peer == snapshot.Peer && x.Revision == snapshot.Revision && x.Status == "active"
                && x.CentralConnectionId == connectionId && x.CentralConnectionGeneration == generation)
            .ExecuteUpdateAsync(update => update
                .SetProperty(x => x.Status, "reconnect_required")
                .SetProperty(x => x.EncryptedRefreshToken, "")
                .SetProperty(x => x.Revision, x => x.Revision + 1), ct);
        if (updated == 1)
            AccessTokens.Remove(CacheKey(snapshot.UserId, snapshot.Peer, connectionId, generation, "nutrition.training_context.read"));
    }

    private static bool HasDurableConnection(IntegrationGrant? grant)
        => grant is not null && grant.CentralConnectionId.HasValue && grant.CentralConnectionGeneration.HasValue;

    private static bool Matches(IntegrationGrant? grant, Guid id, long generation)
        => grant is { Status: "active" } && grant.CentralConnectionId == id && grant.CentralConnectionGeneration == generation;

    private static bool TryCached(string key, long revision, out string? token)
    {
        if (AccessTokens.TryGetValue(key, out var cachedValue) && cachedValue is CachedAccessToken cached
            && cached.GrantRevision == revision && cached.ExpiresAt > DateTime.UtcNow.AddSeconds(60))
        {
            token = cached.Value;
            return true;
        }
        token = null;
        return false;
    }

    private static string CacheKey(Guid userId, string peer, Guid connectionId, long generation, string scope)
        => $"{userId:N}:{peer}:{connectionId:N}:{generation}:{scope}";

    private sealed record CachedAccessToken(string Value, long GrantRevision, DateTime ExpiresAt);
}
