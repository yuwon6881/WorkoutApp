using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ClientExtractedImportText : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // An unfinished import's source lived in the object store this change removes, so it
            // can never be completed. Its row carries no history worth keeping.
            migrationBuilder.Sql("DELETE FROM \"Imports\" WHERE \"Status\" = 'pending';");

            migrationBuilder.DropTable(
                name: "ImportUploads");

            migrationBuilder.DropColumn(
                name: "PendingDispatchAt",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "PendingDispatchChunk",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "VisualFallbacks",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceFileKey",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceFileExpiresAt",
                table: "Imports");

            migrationBuilder.AddColumn<string>(
                name: "SourceTextJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "SourceExpiresAt",
                table: "Imports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NoticesJson",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Imports_SourceExpiresAt",
                table: "Imports",
                column: "SourceExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Imports_SourceExpiresAt",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "NoticesJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceTextJson",
                table: "Imports");

            migrationBuilder.DropColumn(
                name: "SourceExpiresAt",
                table: "Imports");

            migrationBuilder.AddColumn<string>(
                name: "SourceFileKey",
                table: "Imports",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "SourceFileExpiresAt",
                table: "Imports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PendingDispatchAt",
                table: "Imports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PendingDispatchChunk",
                table: "Imports",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VisualFallbacks",
                table: "Imports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "ImportUploads",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpectedBytes = table.Column<long>(type: "bigint", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FileName = table.Column<string>(type: "text", nullable: false),
                    ReceivedBytes = table.Column<long>(type: "bigint", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    SourceFileKey = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false, defaultValue: "open")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportUploads", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_ImportUploads_Status", "\"Status\" IN ('open','processing','completed','cancelled')");
                    table.ForeignKey(
                        name: "FK_ImportUploads_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportUploads_UserId_ExpiresAt",
                table: "ImportUploads",
                columns: new[] { "UserId", "ExpiresAt" });
        }
    }
}
