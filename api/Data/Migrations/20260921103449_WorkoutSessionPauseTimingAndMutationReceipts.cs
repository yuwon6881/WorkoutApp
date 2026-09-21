using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkoutSessionPauseTimingAndMutationReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastTimingEventAt",
                table: "Workouts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PausedAt",
                table: "Workouts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PausedSeconds",
                table: "Workouts",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "Operation",
                table: "Receipts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequestHash",
                table: "Receipts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ResourceId",
                table: "Receipts",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastTimingEventAt",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "PausedAt",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "PausedSeconds",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "Operation",
                table: "Receipts");

            migrationBuilder.DropColumn(
                name: "RequestHash",
                table: "Receipts");

            migrationBuilder.DropColumn(
                name: "ResourceId",
                table: "Receipts");
        }
    }
}
