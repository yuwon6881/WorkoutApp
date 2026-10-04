using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CrossAppAiNutritionSummary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SummaryFetchedAt",
                table: "NutritionContexts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "SummaryFrom",
                table: "NutritionContexts",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SummaryJson",
                table: "NutritionContexts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SummaryTimeZone",
                table: "NutritionContexts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "SummaryTo",
                table: "NutritionContexts",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SummaryFetchedAt",
                table: "NutritionContexts");

            migrationBuilder.DropColumn(
                name: "SummaryFrom",
                table: "NutritionContexts");

            migrationBuilder.DropColumn(
                name: "SummaryJson",
                table: "NutritionContexts");

            migrationBuilder.DropColumn(
                name: "SummaryTimeZone",
                table: "NutritionContexts");

            migrationBuilder.DropColumn(
                name: "SummaryTo",
                table: "NutritionContexts");
        }
    }
}
