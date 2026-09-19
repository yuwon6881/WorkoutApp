using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DurableImportLeases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LeaseId",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "LeaseUntil",
                table: "Imports",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LeaseId",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "LeaseUntil",
                table: "Imports");
        }
    }
}
