using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services;

/// A readable copy of the account for the user's own records. It is not a restore format:
/// there is no import path back, so nothing here has to round-trip.
public sealed class ExportService(AppDb db, ProgramService programs, TemplateService templates, WorkoutService workouts)
{
    public async Task<object> Build(CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
        var history = await db.Workouts.AsNoTracking().Where(w => w.FinishedAt != null).OrderByDescending(w => w.FinishedAt).ToListAsync(ct);
        var sessions = new List<SessionView>();
        foreach (var row in history) sessions.Add(await workouts.View(row, ct));
        return new
        {
            exportedAt = DateTime.UtcNow,
            account = new { displayName = user.DisplayName, user.Unit, user.Theme, user.RestSeconds, user.RestAlerts },
            note = "Weights are stored in kilograms. A null weight means the load was not recorded.",
            programs = await programs.FullList(ct),
            templates = await templates.List(null, standaloneOnly: true, ct),
            history = sessions
        };
    }
}
