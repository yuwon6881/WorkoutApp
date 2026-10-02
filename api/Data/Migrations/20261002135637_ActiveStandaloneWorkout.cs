using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ActiveStandaloneWorkout : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "Templates",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "ActiveCompletedAt",
                table: "Templates",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Templates_ActivePerUser",
                table: "Templates",
                column: "UserId",
                unique: true,
                filter: "\"Active\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Templates_ActiveStandalone",
                table: "Templates",
                sql: "NOT \"Active\" OR \"ProgramId\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Templates_ActivePerUser",
                table: "Templates");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Templates_ActiveStandalone",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "Active",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "ActiveCompletedAt",
                table: "Templates");
        }
    }
}
