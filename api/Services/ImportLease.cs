using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    private static readonly TimeSpan ExecutionLeaseDuration = TimeSpan.FromMinutes(5);

    private static string NewLeaseId() => Guid.NewGuid().ToString("N");

    private static bool LeaseHeldByAnother(AiImport import, string leaseId, DateTime now)
        => import.LeaseUntil > now && !string.Equals(import.LeaseId, leaseId, StringComparison.Ordinal);

    private static bool OwnsLease(AiImport import, string leaseId)
        => string.Equals(import.LeaseId, leaseId, StringComparison.Ordinal);

    private static void ClaimLease(AiImport import, string leaseId, DateTime now)
    {
        import.LeaseId = leaseId;
        import.LeaseUntil = now.Add(ExecutionLeaseDuration);
    }

    private static void RenewLease(AiImport import)
        => import.LeaseUntil = DateTime.UtcNow.Add(ExecutionLeaseDuration);

    private static void ReleaseLease(AiImport import)
    {
        import.LeaseId = "";
        import.LeaseUntil = null;
    }
}
