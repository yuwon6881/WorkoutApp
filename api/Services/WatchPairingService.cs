using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record WatchPairingStartResult(Guid PairingId, string Code, DateTime ExpiresAt);
public sealed record WatchPairingStatusResult(string Status, DateTime ExpiresAt);
public sealed record WatchDeviceView(Guid Id, string DeviceId, string DeviceName, DateTime CreatedAt, DateTime ExpiresAt);

public sealed class WatchPairingService(AppDb db)
{
    private static readonly char[] CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray();
    private static readonly TimeSpan PairingLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DeviceLifetime = WatchAuthentication.DeviceSessionLifetime;

    public async Task<WatchPairingStartResult> Start(string deviceId, string deviceName, string deviceToken, CancellationToken ct)
    {
        ValidateDevice(deviceId, deviceName, deviceToken);
        var now = DateTime.UtcNow;
        await db.WatchPairings.Where(pairing =>
                (pairing.ApprovedAt == null && pairing.ExpiresAt <= now) ||
                (pairing.ApprovedAt != null && pairing.ApprovedAt < now.AddDays(-7)))
            .ExecuteDeleteAsync(ct);
        await db.WatchDevices.IgnoreQueryFilters()
            .Where(device => device.RevokedAt != null || device.ExpiresAt <= now)
            .ExecuteDeleteAsync(ct);

        var code = NewCode();
        var pairing = new WatchPairing
        {
            DeviceId = deviceId,
            DeviceName = deviceName.Trim(),
            PairingCodeHash = AuthService.Hash(code),
            DeviceTokenHash = AuthService.Hash(deviceToken),
            CreatedAt = now,
            ExpiresAt = now.Add(PairingLifetime)
        };
        db.WatchPairings.Add(pairing);
        await db.SaveChangesAsync(ct);
        return new(pairing.Id, code, pairing.ExpiresAt);
    }

    public async Task<WatchPairingStatusResult> Status(Guid pairingId, string deviceToken, CancellationToken ct)
    {
        ValidateDeviceToken(deviceToken);
        await using var gate = await MutationLock.Acquire(db, null, ct);
        var pairing = await db.WatchPairings.SingleOrDefaultAsync(item => item.Id == pairingId, ct);
        Validation.Require(pairing is not null, "That watch pairing has expired. Start pairing again.", 404);
        var row = pairing!;
        if (!FixedEquals(row.DeviceTokenHash, AuthService.Hash(deviceToken)))
        {
            if (row.FailedStatusAttempts < 5)
            {
                row.FailedStatusAttempts++;
                await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
            throw new DomainException("That watch pairing could not be verified.", 404);
        }

        var now = DateTime.UtcNow;
        if (row.ApprovedAt is { } approvedAt)
        {
            var activeDevice = await db.WatchDevices.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(device => device.UserId == row.ApprovedUserId && device.DeviceId == row.DeviceId &&
                    device.TokenHash == row.DeviceTokenHash && device.RevokedAt == null && device.ExpiresAt > now, ct);
            await gate.Commit(ct);
            return new(activeDevice ? "approved" : "expired", row.ExpiresAt);
        }

        if (row.FailedStatusAttempts >= 5 || row.ExpiresAt <= now)
        {
            await gate.Commit(ct);
            return new("expired", row.ExpiresAt);
        }

        await gate.Commit(ct);
        return new("pending", row.ExpiresAt);
    }

    public async Task<WatchDeviceView> Approve(string code, CancellationToken ct)
    {
        var normalized = NormalizeCode(code);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var now = DateTime.UtcNow;
        var pairing = await db.WatchPairings.SingleOrDefaultAsync(item =>
            item.PairingCodeHash == AuthService.Hash(normalized) && item.ApprovedAt == null && item.ExpiresAt > now &&
            item.FailedStatusAttempts < 5, ct);
        Validation.Require(pairing is not null, "That pairing code is invalid or has expired. Start pairing again on the watch.", 400);

        var row = pairing!;
        var userId = db.CurrentUser!.Value;
        await db.WatchDevices.IgnoreQueryFilters()
            .Where(item => item.RevokedAt != null || item.ExpiresAt <= now)
            .ExecuteDeleteAsync(ct);
        var deviceBelongsToAnotherAccount = await db.WatchDevices.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(item => item.UserId != userId && (item.DeviceId == row.DeviceId || item.TokenHash == row.DeviceTokenHash), ct);
        Validation.Require(!deviceBelongsToAnotherAccount,
            "This watch is connected to another account. Disconnect it from that account, then start pairing again.", 409);
        var device = await db.WatchDevices.SingleOrDefaultAsync(item => item.DeviceId == row.DeviceId, ct);
        device ??= await db.WatchDevices.SingleOrDefaultAsync(item => item.TokenHash == row.DeviceTokenHash, ct);
        if (device is null)
        {
            device = new WatchDevice
            {
                UserId = userId,
                DeviceId = row.DeviceId,
                DeviceName = row.DeviceName,
                TokenHash = row.DeviceTokenHash,
                CreatedAt = now,
                ExpiresAt = now.Add(DeviceLifetime)
            };
            db.WatchDevices.Add(device);
        }
        else
        {
            device.DeviceId = row.DeviceId;
            device.DeviceName = row.DeviceName;
            device.TokenHash = row.DeviceTokenHash;
            device.CreatedAt = now;
            device.ExpiresAt = now.Add(DeviceLifetime);
            device.RevokedAt = null;
            device.Revision++;
        }

        row.ApprovedAt = now;
        row.ApprovedUserId = userId;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return ToView(device);
    }

    public async Task<IReadOnlyList<WatchDeviceView>> List(CancellationToken ct)
        => await db.WatchDevices.AsNoTracking().Where(device => device.RevokedAt == null && device.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(device => device.CreatedAt).Select(device => new WatchDeviceView(
                device.Id, device.DeviceId, device.DeviceName, device.CreatedAt, device.ExpiresAt)).ToListAsync(ct);

    public async Task Revoke(Guid deviceRecordId, CancellationToken ct)
    {
        var device = await db.WatchDevices.SingleOrDefaultAsync(item => item.Id == deviceRecordId, ct);
        Validation.Require(device is not null, "That watch is not connected to this account.", 404);
        device!.RevokedAt = DateTime.UtcNow;
        device.Revision++;
        await db.SaveChangesAsync(ct);
    }

    public async Task RevokeCurrent(string deviceToken, CancellationToken ct)
    {
        var tokenHash = AuthService.Hash(deviceToken);
        var device = await db.WatchDevices.SingleOrDefaultAsync(item => item.TokenHash == tokenHash, ct);
        if (device is null) return;
        device.RevokedAt = DateTime.UtcNow;
        device.Revision++;
        await db.SaveChangesAsync(ct);
    }

    private static WatchDeviceView ToView(WatchDevice device)
        => new(device.Id, device.DeviceId, device.DeviceName, device.CreatedAt, device.ExpiresAt);

    private static void ValidateDevice(string deviceId, string deviceName, string deviceToken)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(deviceId) && deviceId.Length <= 200 &&
            deviceId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'),
            "The watch identifier is invalid.");
        Validation.Require(!string.IsNullOrWhiteSpace(deviceName) && deviceName.Trim().Length <= 120,
            "The watch name is invalid.");
        ValidateDeviceToken(deviceToken);
    }

    private static void ValidateDeviceToken(string deviceToken)
        => Validation.Require(!string.IsNullOrWhiteSpace(deviceToken) && deviceToken.Length is >= 32 and <= 256,
            "The watch session secret is invalid.", 400);

    private static string NormalizeCode(string code)
    {
        Validation.Require(!string.IsNullOrWhiteSpace(code), "Enter the code shown on your watch.", 400);
        var normalized = new string(code.Where(char.IsAsciiLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
        Validation.Require(normalized.Length == 8, "Enter the eight-character code shown on your watch.", 400);
        return normalized;
    }

    private static string NewCode()
    {
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);
        Span<char> characters = stackalloc char[8];
        for (var index = 0; index < bytes.Length; index++)
            characters[index] = CodeAlphabet[bytes[index] % CodeAlphabet.Length];
        return new string(characters);
    }

    private static bool FixedEquals(string expected, string actual)
        => CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual));
}
