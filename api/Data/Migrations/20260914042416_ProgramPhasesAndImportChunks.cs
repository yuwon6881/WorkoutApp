using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProgramPhasesAndImportChunks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Block",
                table: "Templates",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "IsRestDay",
                table: "Templates",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Phase",
                table: "Templates",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "PhaseWeek",
                table: "Templates",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "SequenceGroup",
                table: "TemplateExercises",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SubstitutionsJson",
                table: "TemplateExercises",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<bool>(
                name: "Warmup",
                table: "Sets",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SequenceGroup",
                table: "SessionExercises",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SubstitutionsJson",
                table: "SessionExercises",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<int>(
                name: "Calls",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "CatalogStale",
                table: "Imports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ChunksDone",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ChunksTotal",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "OutlineJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Stage",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "done");

            migrationBuilder.AddColumn<int>(
                name: "UnresolvedCount",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','extract','done')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "Block",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "IsRestDay",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "Phase",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "PhaseWeek",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "SequenceGroup",
                table: "TemplateExercises");

            migrationBuilder.DropColumn(
                name: "SubstitutionsJson",
                table: "TemplateExercises");

            migrationBuilder.DropColumn(
                name: "Warmup",
                table: "Sets");

            migrationBuilder.DropColumn(
                name: "SequenceGroup",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "SubstitutionsJson",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "Calls",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "CatalogStale",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "ChunksDone",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "ChunksTotal",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "OutlineJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "Stage",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "UnresolvedCount",
                table: "Imports");
        }
    }
}
