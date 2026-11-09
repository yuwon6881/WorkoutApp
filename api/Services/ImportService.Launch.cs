using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    /// Launch needs import identity and status, never drafts or restoration analysis.
    public async Task<object> LaunchSummaries(CancellationToken ct)
    {
        return await db.Imports.AsNoTracking().Where(row => row.Status == ImportStatus.Pending || row.Status == ImportStatus.Ready)
            .OrderByDescending(row => row.Created).Take(10)
            .Select(row => new { row.Id, row.Status, row.FileName, row.Pages, row.Error, row.Created, row.Model,
                row.Stage, row.UnresolvedCount, row.ProgramId, row.Revision }).ToListAsync(ct);
    }
}
