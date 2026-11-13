using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Workout.Api.Data.Migrations;
using Xunit;

namespace Workout.Tests;

public sealed class RemoveExerciseOneRepMaxMigrationTests
{
    [Fact]
    public async Task Migration_drops_only_legacy_maxima_and_rollback_recreates_an_empty_table()
    {
        var h = await Harness.Create();
        await using var _ = h;
        await h.SignIn();
        var migration = new RemoveExerciseOneRepMax();
        var drop = Assert.IsType<DropTableOperation>(Assert.Single(migration.UpOperations));
        Assert.Equal("ExerciseOneRepMaxes", drop.Name);
        var create = Assert.IsType<CreateTableOperation>(Assert.Single(migration.DownOperations));
        Assert.Equal("ExerciseOneRepMaxes", create.Name);
        Assert.Equal(new[] { "UserId", "Id", "OneRepMaxKg", "Revision" }, create.Columns.Select(column => column.Name));
        Assert.Equal(new[] { "UserId", "Id" }, create.PrimaryKey!.Columns);
        Assert.Single(create.CheckConstraints);
        Assert.Equal("Users", Assert.Single(create.ForeignKeys).PrincipalTable);
        Assert.DoesNotContain(h.Db.Model.GetEntityTypes(), entity => entity.GetTableName() == "ExerciseOneRepMaxes");

        var generator = h.Db.GetService<IMigrationsSqlGenerator>();
        async Task Run(IReadOnlyList<MigrationOperation> operations)
        {
            foreach (var command in generator.Generate(operations))
                await h.Db.Database.ExecuteSqlRawAsync(command.CommandText);
        }

        await Run(migration.DownOperations);
        var exerciseId = Guid.NewGuid();
        await h.Db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "ExerciseOneRepMaxes" ("UserId", "Id", "OneRepMaxKg", "Revision")
            VALUES ({h.Db.CurrentUser!.Value}, {exerciseId}, {200.0}, {1})
            """);
        await Run(migration.UpOperations);
        await Run(migration.DownOperations);
        await using var query = h.Db.Database.GetDbConnection().CreateCommand();
        query.CommandText = "SELECT COUNT(*) FROM \"ExerciseOneRepMaxes\"";
        Assert.Equal(0L, await query.ExecuteScalarAsync());
        Assert.Single(h.Db.Users);
    }
}