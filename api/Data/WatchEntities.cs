namespace Workout.Api.Data;

/// A revocable, account-scoped opaque session for one Wear OS installation. Only the token hash
/// is stored; the watch creates and keeps the secret in Android Keystore.
public sealed class WatchDevice : OwnedRecord
{
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

/// Temporary pairing challenge. It has no tenant until the signed-in web client approves it.
public sealed class WatchPairing
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DeviceId { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string PairingCodeHash { get; set; } = "";
    public string DeviceTokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public Guid? ApprovedUserId { get; set; }
    public int FailedStatusAttempts { get; set; }
}
