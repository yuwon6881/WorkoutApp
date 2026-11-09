using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemovePdfImporter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The PDF reader is gone, so an unfinished or failed PDF import can never complete. A finished
            // (ready) PDF draft stays, because reviewing and accepting it needs nothing the reader held.
            migrationBuilder.Sql(
                "DELETE FROM \"Imports\" WHERE \"Stage\" NOT IN ('select','done') " +
                "OR \"Status\" = 'failed' OR (\"PromptVersion\" <> 'external-json-v1' AND \"Status\" = 'pending');");

            migrationBuilder.DropIndex(
                name: "IX_Imports_SourceExpiresAt",
                table: "Imports");

            migrationBuilder.DropIndex(
                name: "IX_Imports_UserId_DocumentHash_PromptVersion",
                table: "Imports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Status",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "CachedInputTokens",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "Calls",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "CatalogStale",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "ChunkResultsJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "ChunksDone",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "ChunksTotal",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "DocumentHash",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "InputTokens",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "LeaseId",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "LeaseUntil",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "LinksJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "OutlineJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "OutputTokens",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "PageCoverageJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "Retries",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceExpiresAt",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceTextJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "WorkStateJson",
                table: "Imports");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('select','done')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Status",
                table: "Imports",
                sql: "\"Status\" IN ('pending','ready','accepted','discarded')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Status",
                table: "Imports");

            migrationBuilder.AddColumn<long>(
                name: "CachedInputTokens",
                table: "Imports",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

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

            migrationBuilder.AddColumn<string>(
                name: "ChunkResultsJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

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
                name: "DocumentHash",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "InputTokens",
                table: "Imports",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

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

            migrationBuilder.AddColumn<string>(
                name: "LinksJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OutlineJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "OutputTokens",
                table: "Imports",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "PageCoverageJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Retries",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "SourceExpiresAt",
                table: "Imports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceTextJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "WorkStateJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Imports_SourceExpiresAt",
                table: "Imports",
                column: "SourceExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Imports_UserId_DocumentHash_PromptVersion",
                table: "Imports",
                columns: new[] { "UserId", "DocumentHash", "PromptVersion" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','select','extract','verify','recover','done','failed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Status",
                table: "Imports",
                sql: "\"Status\" IN ('pending','ready','failed','accepted','discarded')");
        }
    }
}
