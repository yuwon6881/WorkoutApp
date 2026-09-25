using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WatchPairingTests
{
    [Fact]
    public async Task Approval_is_single_use_hashes_the_secret_and_revocation_invalidates_the_pair()
    {
        await using var harness = await Harness.Create();
        var owner = await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();

        var challenge = await pairings.Start("watch_install_1", "Pixel Watch", secret, default);
        Assert.Equal(8, challenge.Code.Length);
        Assert.DoesNotContain(secret, challenge.Code);

        var device = await pairings.Approve(challenge.Code, default);
        var saved = await harness.Db.WatchDevices.IgnoreQueryFilters().SingleAsync(row => row.Id == device.Id);
        Assert.Equal(owner.Id, saved.UserId);
        Assert.NotEqual(secret, saved.TokenHash);
        Assert.Equal(AuthService.Hash(secret), saved.TokenHash);
        Assert.Equal("approved", (await pairings.Status(challenge.PairingId, secret, default)).Status);

        var replay = await Assert.ThrowsAsync<DomainException>(() => pairings.Approve(challenge.Code, default));
        Assert.Equal(400, replay.Status);

        await pairings.Revoke(device.Id, default);
        Assert.Equal("expired", (await pairings.Status(challenge.PairingId, secret, default)).Status);
        Assert.Empty(await pairings.List(default));
    }

    [Fact]
    public async Task A_wrong_pair_secret_is_rejected_without_approving_or_consuming_the_code()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_2", "Galaxy Watch", secret, default);

        var failure = await Assert.ThrowsAsync<DomainException>(() => pairings.Status(challenge.PairingId, NewSecret(), default));
        Assert.Equal(404, failure.Status);
        Assert.Equal("pending", (await pairings.Status(challenge.PairingId, secret, default)).Status);
        Assert.Empty(await pairings.List(default));
    }

    [Fact]
    public async Task Pairing_codes_expire_and_cannot_be_approved_after_the_deadline()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_3", "Wear watch", secret, default);
        var saved = await harness.Db.WatchPairings.SingleAsync(row => row.Id == challenge.PairingId);
        saved.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
        await harness.Db.SaveChangesAsync();

        Assert.Equal("expired", (await pairings.Status(challenge.PairingId, secret, default)).Status);
        var failure = await Assert.ThrowsAsync<DomainException>(() => pairings.Approve(challenge.Code, default));
        Assert.Equal(400, failure.Status);
    }

    [Fact]
    public async Task Device_listing_and_revocation_remain_scoped_to_the_signed_in_account()
    {
        await using var harness = await Harness.Create();
        var owner = await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_4", "Wear watch", secret, default);
        var device = await pairings.Approve(challenge.Code, default);

        var other = await harness.CreateUser("other-account");
        harness.Db.CurrentUser = other.Id;
        Assert.Empty(await pairings.List(default));
        var failure = await Assert.ThrowsAsync<DomainException>(() => pairings.Revoke(device.Id, default));
        Assert.Equal(404, failure.Status);

        harness.Db.CurrentUser = owner.Id;
        Assert.Single(await pairings.List(default));
    }

    [Fact]
    public async Task A_watch_secret_cannot_be_approved_for_two_accounts_and_can_move_after_revocation()
    {
        await using var harness = await Harness.Create();
        var owner = await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var firstPairing = await pairings.Start("watch_install_transfer", "Wear watch", secret, default);
        var firstDevice = await pairings.Approve(firstPairing.Code, default);

        var nextOwner = await harness.CreateUser("next-owner");
        harness.Db.CurrentUser = nextOwner.Id;
        var nextSecret = NewSecret();
        var blockedPairing = await pairings.Start("watch_install_transfer", "Wear watch", nextSecret, default);
        var blocked = await Assert.ThrowsAsync<DomainException>(() => pairings.Approve(blockedPairing.Code, default));
        Assert.Equal(409, blocked.Status);

        harness.Db.CurrentUser = owner.Id;
        await pairings.Revoke(firstDevice.Id, default);
        harness.Db.CurrentUser = nextOwner.Id;
        var retryPairing = await pairings.Start("watch_install_transfer", "Wear watch", nextSecret, default);
        var transferredDevice = await pairings.Approve(retryPairing.Code, default);

        Assert.NotEqual(firstDevice.Id, transferredDevice.Id);
        Assert.Equal("expired", (await pairings.Status(firstPairing.PairingId, secret, default)).Status);
        Assert.Single(await pairings.List(default));
    }

    [Fact]
    public async Task Device_tokens_resolve_only_their_owner_and_stop_working_after_revocation()
    {
        await using var harness = await Harness.Create();
        var owner = await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_auth", "Wear watch", secret, default);
        var device = await pairings.Approve(challenge.Code, default);

        var other = await harness.CreateUser("token-other");
        harness.Db.CurrentUser = other.Id;
        Assert.Equal(owner.Id, await WatchAuthentication.FindAccountForDeviceToken(harness.Db, secret, default));
        Assert.Null(await WatchAuthentication.FindAccountForDeviceToken(harness.Db, NewSecret(), default));

        harness.Db.CurrentUser = owner.Id;
        await pairings.Revoke(device.Id, default);
        Assert.Null(await WatchAuthentication.FindAccountForDeviceToken(harness.Db, secret, default));
    }

    [Fact]
    public async Task Device_session_expiry_is_extended_when_the_watch_is_used_near_its_idle_deadline()
    {
        await using var harness = await Harness.Create();
        var owner = await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_renewal", "Wear watch", secret, default);
        var device = await pairings.Approve(challenge.Code, default);
        var row = await harness.Db.WatchDevices.IgnoreQueryFilters().SingleAsync(item => item.Id == device.Id);
        row.ExpiresAt = DateTime.UtcNow.AddDays(1);
        await harness.Db.SaveChangesAsync();

        Assert.Equal(owner.Id, await WatchAuthentication.FindAccountForDeviceToken(harness.Db, secret, default));

        var renewed = await harness.Db.WatchDevices.IgnoreQueryFilters().AsNoTracking().SingleAsync(item => item.Id == device.Id);
        Assert.True(renewed.ExpiresAt > DateTime.UtcNow.AddDays(364));
    }

    [Fact]
    public async Task An_expired_idle_device_session_cannot_renew_itself()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_idle", "Wear watch", secret, default);
        var device = await pairings.Approve(challenge.Code, default);
        var row = await harness.Db.WatchDevices.IgnoreQueryFilters().SingleAsync(item => item.Id == device.Id);
        row.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
        await harness.Db.SaveChangesAsync();

        Assert.Null(await WatchAuthentication.FindAccountForDeviceToken(harness.Db, secret, default));
    }

    [Fact]
    public async Task Five_invalid_status_checks_expire_the_pending_challenge()
    {
        await using var harness = await Harness.Create();
        await harness.SignIn();
        var pairings = new WatchPairingService(harness.Db);
        var secret = NewSecret();
        var challenge = await pairings.Start("watch_install_5", "Wear watch", secret, default);

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var failure = await Assert.ThrowsAsync<DomainException>(() => pairings.Status(challenge.PairingId, NewSecret(), default));
            Assert.Equal(404, failure.Status);
        }

        var expired = await pairings.Status(challenge.PairingId, secret, default);
        Assert.Equal("expired", expired.Status);
    }

    private static string NewSecret() => Convert.ToBase64String(Guid.NewGuid().ToByteArray()) + Convert.ToBase64String(Guid.NewGuid().ToByteArray());
}
