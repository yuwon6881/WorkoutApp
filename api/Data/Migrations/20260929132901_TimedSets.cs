using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TimedSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets");

            migrationBuilder.AddColumn<int>(
                name: "DurationSeconds",
                table: "Sets",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrackingMode",
                table: "Exercises",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "reps");

            migrationBuilder.AddColumn<string>(
                name: "TrackingMode",
                table: "CustomExercises",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "reps");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets",
                sql: "NOT \"Done\" OR \"Reps\" IS NOT NULL OR \"DurationSeconds\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_Duration",
                table: "Sets",
                sql: "\"DurationSeconds\" IS NULL OR (\"DurationSeconds\" > 0 AND \"DurationSeconds\" <= 7200)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_TrackingMode",
                table: "Exercises",
                sql: "\"TrackingMode\" IN ('reps','duration')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomExercises_TrackingMode",
                table: "CustomExercises",
                sql: "\"TrackingMode\" IN ('reps','duration')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Sets_Duration",
                table: "Sets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_TrackingMode",
                table: "Exercises");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomExercises_TrackingMode",
                table: "CustomExercises");

            migrationBuilder.DropColumn(
                name: "DurationSeconds",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "TrackingMode",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "TrackingMode",
                table: "CustomExercises");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Sets_Done",
                table: "Sets",
                sql: "NOT \"Done\" OR \"Reps\" IS NOT NULL");
        }
    }
}
