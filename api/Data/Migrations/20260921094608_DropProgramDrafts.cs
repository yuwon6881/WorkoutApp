using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropProgramDrafts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramDrafts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProgramDrafts",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedProgramId = table.Column<Guid>(type: "uuid", nullable: true),
                    DraftJson = table.Column<string>(type: "text", nullable: false),
                    ProgramName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RequestKey = table.Column<Guid>(type: "uuid", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Updated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramDrafts", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramDrafts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_UserId_CreatedProgramId",
                table: "ProgramDrafts",
                columns: new[] { "UserId", "CreatedProgramId" },
                unique: true,
                filter: "\"CreatedProgramId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_UserId_RequestKey",
                table: "ProgramDrafts",
                columns: new[] { "UserId", "RequestKey" },
                unique: true,
                filter: "\"RequestKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_UserId_Updated",
                table: "ProgramDrafts",
                columns: new[] { "UserId", "Updated" });
        }
    }
}
