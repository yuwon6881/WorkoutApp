using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Workout.Api.Data;

/// Keep migrations provider-stable when local development uses SQLite. Production and migration
/// validation use PostgreSQL, so EF must scaffold PostgreSQL column types even without a live DB.
public sealed class DesignTimeDbFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("WORKOUT_DESIGN_DATABASE")
            ?? "Host=localhost;Database=workout_design;Username=workout;Password=workout";
        var options = new DbContextOptionsBuilder<AppDb>().UseNpgsql(connection).Options;
        return new AppDb(options);
    }
}
