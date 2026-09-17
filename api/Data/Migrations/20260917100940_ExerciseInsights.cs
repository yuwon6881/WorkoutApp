using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseInsights : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomExercises",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Muscle = table.Column<string>(type: "text", nullable: false),
                    Equipment = table.Column<string>(type: "text", nullable: false),
                    Cue = table.Column<string>(type: "text", nullable: false),
                    LoadStepKg = table.Column<double>(type: "double precision", nullable: false, defaultValue: 2.5),
                    LoadModel = table.Column<string>(type: "text", nullable: false, defaultValue: "external"),
                    MovementPattern = table.Column<string>(type: "text", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomExercises", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_CustomExercises_LoadModel", "\"LoadModel\" IN ('external','full_bodyweight','bodyweight_context_only','reps_only')");
                    table.CheckConstraint("CK_CustomExercises_LoadStep", "\"LoadStepKg\" >= 0 AND \"LoadStepKg\" <= 50");
                    table.ForeignKey(
                        name: "FK_CustomExercises_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExerciseHistoryClears",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    NameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ClearedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RemovedSets = table.Column<int>(type: "integer", nullable: false),
                    AffectedWorkouts = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseHistoryClears", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ExerciseHistoryClears_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomExercises_UserId_Name",
                table: "CustomExercises",
                columns: new[] { "UserId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseHistoryClears_UserId_ExerciseId_ClearedAt",
                table: "ExerciseHistoryClears",
                columns: new[] { "UserId", "ExerciseId", "ClearedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomExercises");

            migrationBuilder.DropTable(
                name: "ExerciseHistoryClears");
        }
    }
}
