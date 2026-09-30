using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Workout.Api.Data;
using Workout.Api.Data.Migrations;
using Xunit;

namespace Workout.Tests;

/// Runs the migration's actual data conversion SQL against isolated legacy tables.
public sealed class LoadSettingsMigrationTests
{
    private static async Task<SqliteConnection> LegacyDatabase()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await Execute(connection, """
            CREATE TABLE "LoadStacks" (
                "UserId" TEXT, "Id" TEXT, "LoadStepKg" REAL, "AvailableLoadsJson" TEXT);
            CREATE TABLE "ExerciseLoadSettings" (
                "UserId" TEXT, "Id" TEXT, "LoadStepKg" REAL, "AvailableLoadsJson" TEXT,
                "StackId" TEXT, "Revision" INTEGER);
            CREATE TABLE "EquipmentLoadDefaults" (
                "UserId" TEXT, "Id" TEXT, "Equipment" TEXT, "LoadStepKg" REAL,
                "AvailableLoadsJson" TEXT, "StackId" TEXT, "Revision" INTEGER,
                UNIQUE ("UserId", "Equipment"));
            """);
        return connection;
    }

    private static async Task Execute(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task ConvertRules(SqliteConnection connection)
    {
        foreach (var operation in new SimplifyLoadSettings().UpOperations.OfType<SqlOperation>())
            await Execute(connection, operation.Sql);
    }

    [Fact]
    public async Task Stack_references_become_owned_concrete_rules_without_dangling_references()
    {
        await using var connection = await LegacyDatabase();
        await Execute(connection, """
            INSERT INTO "LoadStacks" VALUES ('alice', 'list', NULL, '[5,12.5,20]'), ('alice', 'step', 8.75, NULL);
            INSERT INTO "ExerciseLoadSettings" VALUES
                ('alice', 'list-exercise', NULL, NULL, 'list', 3),
                ('alice', 'step-exercise', NULL, NULL, 'step', 4),
                ('bob', 'foreign-exercise', NULL, NULL, 'list', 1),
                ('alice', 'missing-exercise', NULL, NULL, 'missing', 2),
                ('alice', 'own-exercise', 1.25, NULL, NULL, 5);
            INSERT INTO "EquipmentLoadDefaults" VALUES ('alice', 'cable', 'cable', NULL, NULL, 'list', 2);
            """);
        await ConvertRules(connection);

        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "LoadStepKg", "AvailableLoadsJson", "StackId", "Revision"
            FROM "ExerciseLoadSettings" ORDER BY "Id";
            """;
        await using (var reader = await command.ExecuteReaderAsync())
        {
            var rows = new Dictionary<string, (double? Step, string? List, int Revision)>();
            while (await reader.ReadAsync())
            {
                Assert.True(reader.IsDBNull(3));
                rows[reader.GetString(0)] = (reader.IsDBNull(1) ? null : reader.GetDouble(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2), reader.GetInt32(4));
            }
            Assert.Equal((null, "[5,12.5,20]", 4), rows["list-exercise"]);
            Assert.Equal((8.75, null, 5), rows["step-exercise"]);
            Assert.Equal((null, (string?)null, 2), rows["foreign-exercise"]);
            Assert.Equal((null, (string?)null, 3), rows["missing-exercise"]);
            Assert.Equal((1.25, null, 5), rows["own-exercise"]);
        }
        command.CommandText = """
            SELECT "AvailableLoadsJson", "StackId", "Revision" FROM "EquipmentLoadDefaults";
            """;
        await using var equipment = await command.ExecuteReaderAsync();
        Assert.True(await equipment.ReadAsync());
        Assert.Equal("[5,12.5,20]", equipment.GetString(0));
        Assert.True(equipment.IsDBNull(1));
        Assert.Equal(3, equipment.GetInt32(2));
    }

    [Fact]
    public async Task Group_merge_keeps_the_existing_plate_loaded_rule_or_selects_one_legacy_rule()
    {
        await using var connection = await LegacyDatabase();
        await Execute(connection, """
            INSERT INTO "EquipmentLoadDefaults" VALUES
                ('alice', 'a-bar', 'barbell', 5, NULL, NULL, 2),
                ('alice', 'a-plate', 'plate', 1.25, NULL, NULL, 3),
                ('alice', 'a-added', 'added-load', 7.5, NULL, NULL, 4),
                ('bob', 'b-plate', 'plate', 1.25, NULL, NULL, 3),
                ('bob', 'b-added', 'added-load', 7.5, NULL, NULL, 4),
                ('carol', 'c-added', 'added-load', NULL, '[0,5,10]', NULL, 4),
                ('dave', 'd-plate', 'plate', NULL, NULL, NULL, 3),
                ('dave', 'd-added', 'added-load', 8, NULL, NULL, 4),
                ('eve', 'e-bar', 'barbell', NULL, NULL, NULL, 2),
                ('eve', 'e-plate', 'plate', 1.25, NULL, NULL, 3);
            """);
        await ConvertRules(connection);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "UserId", "Equipment", "LoadStepKg", "AvailableLoadsJson", "Revision"
            FROM "EquipmentLoadDefaults" ORDER BY "UserId";
            """;
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new Dictionary<string, (double? Step, string? List, int Revision)>();
        while (await reader.ReadAsync())
        {
            Assert.Equal("barbell", reader.GetString(1));
            rows[reader.GetString(0)] = (reader.IsDBNull(2) ? null : reader.GetDouble(2),
                reader.IsDBNull(3) ? null : reader.GetString(3), reader.GetInt32(4));
        }
        Assert.Equal(5, rows.Count);
        Assert.Equal((5.0, null, 3), rows["alice"]);
        Assert.Equal((1.25, null, 4), rows["bob"]);
        Assert.Equal((null, "[0,5,10]", 5), rows["carol"]);
        Assert.Equal((8.0, null, 5), rows["dave"]);
        Assert.Equal((null, (string?)null, 3), rows["eve"]);
    }

    [Fact]
    public async Task Current_schema_has_no_stack_table_or_exercise_dependency()
    {
        await using var h = await Harness.Create();
        Assert.Null(h.Db.Model.FindEntityType("Workout.Api.Data.LoadStack"));
        Assert.Null(h.Db.Model.FindEntityType(typeof(ExerciseLoadSetting))!.FindProperty("StackId"));
        Assert.Null(h.Db.Model.FindEntityType(typeof(EquipmentLoadDefault))!.FindProperty("StackId"));
    }
}
