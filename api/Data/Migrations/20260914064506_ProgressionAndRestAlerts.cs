using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProgressionAndRestAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "RestAlerts",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "ProgressionJson",
                table: "SessionExercises",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "LoadStepKg",
                table: "Exercises",
                type: "double precision",
                nullable: false,
                defaultValue: 2.5);

            migrationBuilder.CreateTable(
                name: "Progress",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    NameKey = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    TrendE1rmKg = table.Column<double>(type: "double precision", nullable: false),
                    LastE1rmKg = table.Column<double>(type: "double precision", nullable: false),
                    Stalls = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Progress", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_Progress_E1rm", "\"TrendE1rmKg\" >= 0 AND \"LastE1rmKg\" >= 0");
                    table.ForeignKey(
                        name: "FK_Progress_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_LoadStep",
                table: "Exercises",
                sql: "\"LoadStepKg\" >= 0 AND \"LoadStepKg\" <= 50");

            migrationBuilder.CreateIndex(
                name: "IX_Progress_ExercisePerUser",
                table: "Progress",
                columns: new[] { "UserId", "ExerciseId", "NameKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Progress");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_LoadStep",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "RestAlerts",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ProgressionJson",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "LoadStepKg",
                table: "Exercises");
        }
    }
}
