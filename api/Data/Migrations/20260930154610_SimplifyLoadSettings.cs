using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SimplifyLoadSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ExerciseLoadSettings_OneRule",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_EquipmentLoadDefaults_OneRule",
                table: "EquipmentLoadDefaults");

            // Materialize each owner's referenced rule before removing reusable stacks. Missing
            // or foreign references become empty rules, matching their previous fallback behavior.
            foreach (var table in new[] { "ExerciseLoadSettings", "EquipmentLoadDefaults" })
            {
                migrationBuilder.Sql($"""
                    UPDATE "{table}"
                    SET "LoadStepKg" = (
                            SELECT s."LoadStepKg" FROM "LoadStacks" s
                            WHERE s."UserId" = "{table}"."UserId" AND s."Id" = "{table}"."StackId"),
                        "AvailableLoadsJson" = (
                            SELECT s."AvailableLoadsJson" FROM "LoadStacks" s
                            WHERE s."UserId" = "{table}"."UserId" AND s."Id" = "{table}"."StackId"),
                        "StackId" = NULL,
                        "Revision" = "Revision" + 1
                    WHERE "StackId" IS NOT NULL;
                    """);
            }

            // Keep the existing Plate-loaded rule. Without one, prefer the old Plate rule,
            // then Added load. All three types will use this single rule from now on.
            foreach (var legacy in new[] { "plate", "added-load" })
            {
                migrationBuilder.Sql($"""
                    UPDATE "EquipmentLoadDefaults"
                    SET "Equipment" = 'barbell'
                    WHERE "Equipment" = '{legacy}'
                        AND ("LoadStepKg" IS NOT NULL OR "AvailableLoadsJson" IS NOT NULL)
                        AND NOT EXISTS (
                            SELECT 1 FROM "EquipmentLoadDefaults" existing
                            WHERE existing."UserId" = "EquipmentLoadDefaults"."UserId"
                                AND existing."Equipment" = 'barbell');
                    """);
            }
            migrationBuilder.Sql("""
                DELETE FROM "EquipmentLoadDefaults" WHERE "Equipment" IN ('plate', 'added-load');
                UPDATE "EquipmentLoadDefaults" SET "Revision" = "Revision" + 1 WHERE "Equipment" = 'barbell';
                """);

            migrationBuilder.DropTable(name: "LoadStacks");

            migrationBuilder.DropColumn(
                name: "StackId",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropColumn(
                name: "StackId",
                table: "EquipmentLoadDefaults");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ExerciseLoadSettings_OneRule",
                table: "ExerciseLoadSettings",
                sql: "\"LoadStepKg\" IS NULL OR \"AvailableLoadsJson\" IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_EquipmentLoadDefaults_OneRule",
                table: "EquipmentLoadDefaults",
                sql: "\"LoadStepKg\" IS NULL OR \"AvailableLoadsJson\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ExerciseLoadSettings_OneRule",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_EquipmentLoadDefaults_OneRule",
                table: "EquipmentLoadDefaults");

            migrationBuilder.AddColumn<Guid>(
                name: "StackId",
                table: "ExerciseLoadSettings",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "StackId",
                table: "EquipmentLoadDefaults",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "LoadStacks",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AvailableLoadsJson = table.Column<string>(type: "text", nullable: true),
                    LoadStepKg = table.Column<double>(type: "double precision", nullable: true),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoadStacks", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_LoadStacks_OneRule", "(CASE WHEN \"LoadStepKg\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"AvailableLoadsJson\" IS NULL THEN 0 ELSE 1 END) = 1");
                    table.CheckConstraint("CK_LoadStacks_Step", "\"LoadStepKg\" IS NULL OR (\"LoadStepKg\" > 0 AND \"LoadStepKg\" <= 50)");
                    table.ForeignKey(
                        name: "FK_LoadStacks_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_ExerciseLoadSettings_OneRule",
                table: "ExerciseLoadSettings",
                sql: "(CASE WHEN \"LoadStepKg\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"AvailableLoadsJson\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"StackId\" IS NULL THEN 0 ELSE 1 END) <= 1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_EquipmentLoadDefaults_OneRule",
                table: "EquipmentLoadDefaults",
                sql: "(CASE WHEN \"LoadStepKg\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"AvailableLoadsJson\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"StackId\" IS NULL THEN 0 ELSE 1 END) <= 1");

            migrationBuilder.CreateIndex(
                name: "IX_LoadStacks_UserId_Name",
                table: "LoadStacks",
                columns: new[] { "UserId", "Name" },
                unique: true);
        }
    }
}
