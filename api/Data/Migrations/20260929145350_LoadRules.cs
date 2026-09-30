using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class LoadRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "StackId",
                table: "ExerciseLoadSettings",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EquipmentLoadDefaults",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Equipment = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LoadStepKg = table.Column<double>(type: "double precision", nullable: true),
                    AvailableLoadsJson = table.Column<string>(type: "text", nullable: true),
                    StackId = table.Column<Guid>(type: "uuid", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EquipmentLoadDefaults", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_EquipmentLoadDefaults_OneRule", "(CASE WHEN \"LoadStepKg\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"AvailableLoadsJson\" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN \"StackId\" IS NULL THEN 0 ELSE 1 END) <= 1");
                    table.CheckConstraint("CK_EquipmentLoadDefaults_Step", "\"LoadStepKg\" IS NULL OR (\"LoadStepKg\" >= 0 AND \"LoadStepKg\" <= 50)");
                    table.ForeignKey(
                        name: "FK_EquipmentLoadDefaults_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LoadStacks",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    LoadStepKg = table.Column<double>(type: "double precision", nullable: true),
                    AvailableLoadsJson = table.Column<string>(type: "text", nullable: true),
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

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentLoadDefaults_UserId_Equipment",
                table: "EquipmentLoadDefaults",
                columns: new[] { "UserId", "Equipment" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LoadStacks_UserId_Name",
                table: "LoadStacks",
                columns: new[] { "UserId", "Name" },
                unique: true);
            // A custom exercise used to carry a hand-typed increment as its only step. It becomes that
            // exercise's own rule, so an account equipment default never silently replaces it, and the
            // stored step returns to the equipment's app default (Progression.StepForEquipment today).
            const string appStep = "CASE WHEN c.\"LoadModel\" = 'full_bodyweight' THEN 2.5 ELSE CASE lower(trim(c.\"Equipment\")) " +
                "WHEN 'bodyweight' THEN 0 WHEN 'band' THEN 0 WHEN 'dumbbell' THEN 2 WHEN 'kettlebell' THEN 4 WHEN 'plate' THEN 1.25 ELSE 2.5 END END";
            migrationBuilder.Sql($"""
                INSERT INTO "ExerciseLoadSettings" ("UserId", "Id", "LoadStepKg", "Revision")
                SELECT c."UserId", c."Id", c."LoadStepKg", 1 FROM "CustomExercises" c
                WHERE NOT EXISTS (SELECT 1 FROM "ExerciseLoadSettings" s WHERE s."UserId" = c."UserId" AND s."Id" = c."Id")
                  AND abs(c."LoadStepKg" - ({appStep})) > 0.000001;
                UPDATE "CustomExercises" c SET "LoadStepKg" = {appStep};
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EquipmentLoadDefaults");

            migrationBuilder.DropTable(
                name: "LoadStacks");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ExerciseLoadSettings_OneRule",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropColumn(
                name: "StackId",
                table: "ExerciseLoadSettings");
        }
    }
}
