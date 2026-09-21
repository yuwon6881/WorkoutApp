using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CustomProgramsAndSequentialProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProgramDayProgressId",
                table: "Workouts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProgramDayProgresses",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    RunId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Week = table.Column<int>(type: "integer", nullable: false),
                    Attempt = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    PassedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramDayProgresses", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramDayProgresses_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramDrafts",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    DraftJson = table.Column<string>(type: "text", nullable: false),
                    RequestKey = table.Column<Guid>(type: "uuid", nullable: true),
                    Created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Updated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedProgramId = table.Column<Guid>(type: "uuid", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "ProgramRuns",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    CurrentWeek = table.Column<int>(type: "integer", nullable: false),
                    CurrentAttempt = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramRuns", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramRuns_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_UserId_ProgramDayProgressId",
                table: "Workouts",
                columns: new[] { "UserId", "ProgramDayProgressId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDayProgresses_UserId_ProgramId_RunId_Week_Attempt",
                table: "ProgramDayProgresses",
                columns: new[] { "UserId", "ProgramId", "RunId", "Week", "Attempt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDayProgresses_UserId_RunId_Week_Attempt_TemplateId",
                table: "ProgramDayProgresses",
                columns: new[] { "UserId", "RunId", "Week", "Attempt", "TemplateId" },
                unique: true);

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

            migrationBuilder.CreateIndex(
                name: "IX_ProgramRuns_UserId_ProgramId_CompletedAt",
                table: "ProgramRuns",
                columns: new[] { "UserId", "ProgramId", "CompletedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramRuns_UserId_ProgramId_Number",
                table: "ProgramRuns",
                columns: new[] { "UserId", "ProgramId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramDayProgresses");

            migrationBuilder.DropTable(
                name: "ProgramDrafts");

            migrationBuilder.DropTable(
                name: "ProgramRuns");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_UserId_ProgramDayProgressId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "ProgramDayProgressId",
                table: "Workouts");
        }
    }
}
