using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AdaptiveProgressionAndScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets");

            migrationBuilder.AddColumn<string>(
                name: "BodyWeightSnapshotJson",
                table: "Workouts",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NutritionContextJson",
                table: "Workouts",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "NutritionContextRevision",
                table: "Workouts",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlannedDate",
                table: "Workouts",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IdentitySubject",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Weekday",
                table: "Templates",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResistanceMode",
                table: "Sets",
                type: "text",
                nullable: false,
                defaultValue: "external");

            migrationBuilder.AddColumn<string>(
                name: "SuggestionJson",
                table: "Sets",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "SystemLoadKg",
                table: "Sets",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WorkingSetOrdinal",
                table: "Sets",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LoadModel",
                table: "SessionExercises",
                type: "text",
                nullable: false,
                defaultValue: "external");

            migrationBuilder.AddColumn<DateOnly>(
                name: "ScheduleAnchor",
                table: "Programs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LoadModel",
                table: "Exercises",
                type: "text",
                nullable: false,
                defaultValue: "external");

            migrationBuilder.CreateTable(
                name: "NutritionContexts",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContextJson = table.Column<string>(type: "text", nullable: false),
                    LastSuccessAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastErrorAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NutritionContexts", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_NutritionContexts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_UserId_PlannedDate",
                table: "Workouts",
                columns: new[] { "UserId", "PlannedDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Users_IdentitySubject",
                table: "Users",
                column: "IdentitySubject",
                unique: true,
                filter: "\"IdentitySubject\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Templates_UserId_ProgramId_Week_Weekday",
                table: "Templates",
                columns: new[] { "UserId", "ProgramId", "Week", "Weekday" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets",
                sql: "NOT \"Done\" OR \"Reps\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_ResistanceMode",
                table: "Sets",
                sql: "\"ResistanceMode\" IN ('external','bodyweight','added','assistance','reps_only')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_SystemLoad",
                table: "Sets",
                sql: "\"SystemLoadKg\" IS NULL OR (\"SystemLoadKg\" >= 0 AND \"SystemLoadKg\" <= 1000)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_LoadModel",
                table: "Exercises",
                sql: "\"LoadModel\" IN ('external','full_bodyweight','bodyweight_context_only','reps_only')");

            // Preserve the old zero-load bodyweight convention only where the catalog has an
            // explicit full-bodyweight model. Other historical weights remain external, and no
            // bodyweight snapshot is manufactured for old sessions.
            migrationBuilder.Sql("""
                UPDATE "SessionExercises" AS se
                SET "LoadModel" = e."LoadModel"
                FROM "Exercises" AS e
                WHERE se."ExerciseId" = e."Id"
                  AND e."LoadModel" <> 'external';

                UPDATE "Sets" AS s
                SET "ResistanceMode" = 'bodyweight'
                FROM "SessionExercises" AS se
                JOIN "Exercises" AS e ON e."Id" = se."ExerciseId"
                WHERE s."SessionExerciseId" = se."Id"
                  AND s."WeightKg" = 0
                  AND e."LoadModel" = 'full_bodyweight';
                UPDATE "Exercises"
                SET "LoadStepKg" = 2.5
                WHERE "LoadModel" = 'full_bodyweight' AND "LoadStepKg" = 0;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NutritionContexts");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_UserId_PlannedDate",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_Users_IdentitySubject",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Templates_UserId_ProgramId_Week_Weekday",
                table: "Templates");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_ResistanceMode",
                table: "Sets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_SystemLoad",
                table: "Sets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_LoadModel",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "BodyWeightSnapshotJson",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "NutritionContextJson",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "NutritionContextRevision",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "PlannedDate",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "IdentitySubject",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Weekday",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "ResistanceMode",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "SuggestionJson",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "SystemLoadKg",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "WorkingSetOrdinal",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "LoadModel",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "ScheduleAnchor",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "LoadModel",
                table: "Exercises");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets",
                sql: "NOT \"Done\" OR (\"Reps\" IS NOT NULL AND \"Rpe\" IS NOT NULL)");
        }
    }
}
