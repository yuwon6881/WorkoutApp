using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveSchedulingPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Workouts_UserId_PlannedDate",
                table: "Workouts");

            migrationBuilder.DropIndex(
                name: "IX_Templates_UserId_ProgramId_Week_Weekday",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "PlannedDate",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "Weekday",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "ScheduleAnchor",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "TimeZone",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "StartDate",
                table: "ProgramPhases");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "PlannedDate",
                table: "Workouts",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Weekday",
                table: "Templates",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ScheduleAnchor",
                table: "Programs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZone",
                table: "Programs",
                type: "text",
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.AddColumn<DateOnly>(
                name: "StartDate",
                table: "ProgramPhases",
                type: "date",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_UserId_PlannedDate",
                table: "Workouts",
                columns: new[] { "UserId", "PlannedDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Templates_UserId_ProgramId_Week_Weekday",
                table: "Templates",
                columns: new[] { "UserId", "ProgramId", "Week", "Weekday" });
        }
    }
}
