using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// Launch needs job identity/progress, never PDF source, drafts, or restoration analysis.
    public async Task<object> LaunchSummaries(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow - FailedImportRetention;
        return await db.Imports.AsNoTracking().Where(row => row.Status == ImportStatus.Pending || row.Status == ImportStatus.Ready ||
                row.Status == ImportStatus.Failed && row.Created >= cutoff)
            .OrderByDescending(row => row.Created).Take(10)
            .Select(row => new { row.Id, row.Status, row.FileName, row.Pages, row.Error, row.Created, row.Model,
                row.Stage, row.ChunksDone, row.ChunksTotal, row.UnresolvedCount, row.ProgramId, row.Revision, row.Retries }).ToListAsync(ct);
    }
}
