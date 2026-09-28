using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkoutSessionRestState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "RestDeadlineUtc",
                table: "Workouts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RestDurationMs",
                table: "Workouts",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RestGeneration",
                table: "Workouts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RestOriginDeviceId",
                table: "Workouts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RestPausedRemainingMs",
                table: "Workouts",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RestStatus",
                table: "Workouts",
                type: "text",
                nullable: false,
                defaultValue: "idle");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Workouts_RestStatus",
                table: "Workouts",
                sql: "\"RestStatus\" IN ('idle','running','paused','elapsed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Workouts_RestStatus",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestDeadlineUtc",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestDurationMs",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestGeneration",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestOriginDeviceId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestPausedRemainingMs",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "RestStatus",
                table: "Workouts");
        }
    }
}
