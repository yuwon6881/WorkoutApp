using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Workout.Api.Data;

namespace Workout.Api.Services;

public static class ReadModelMaintenance
{
    public static async Task Backfill(IServiceProvider services, CancellationToken ct)
    {
        Guid? after = null;
        while (true)
        {
            await using var scope = services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            var users = await db.Users.AsNoTracking().Where(x => after == null || x.Id.CompareTo(after.Value) > 0)
                .OrderBy(x => x.Id).Select(x => x.Id).Take(20).ToListAsync(ct);
            if (users.Count == 0) return;
            foreach (var user in users)
            {
                db.ChangeTracker.Clear(); db.CurrentUser = user;
                var first = await db.Workouts.AsNoTracking().OrderBy(x => x.StartedAt).FirstOrDefaultAsync(ct);
                if (first != null) await WorkoutPrReadService.Get(db, [first], ct);
                await ProgressReadService.Get(db, scope.ServiceProvider.GetRequiredService<IMemoryCache>(), ct);
                Console.WriteLine($"Read models backfilled for account {user:N}.");
            }
            after = users[^1];
        }
    }
}
