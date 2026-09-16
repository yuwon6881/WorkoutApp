using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ImportAlternativesAndMetrics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.AddColumn<string>(
                name: "AlternativesJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SelectedAlternativeId",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','select','extract','done')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "AlternativesJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SelectedAlternativeId",
                table: "Imports");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','extract','done')");
        }
    }
}
