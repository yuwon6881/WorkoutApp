using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PhasedProgramLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Preserve the lifecycle of programs that predate this migration. Existing inactive
            // programs are standby; their workout and history rows are untouched.
            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt",
                table: "Programs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LifecycleStatus",
                table: "Programs",
                type: "text",
                nullable: false,
                defaultValue: "standby");

            migrationBuilder.AddColumn<string>(
                name: "TimeZone",
                table: "Programs",
                type: "text",
                nullable: false,
                defaultValue: "UTC");

            migrationBuilder.CreateTable(
                name: "ProgramPhases",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Block = table.Column<string>(type: "text", nullable: false),
                    WeekFrom = table.Column<int>(type: "integer", nullable: false),
                    WeekTo = table.Column<int>(type: "integer", nullable: false),
                    DurationWeeks = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    SourcePageFrom = table.Column<int>(type: "integer", nullable: true),
                    SourcePageTo = table.Column<int>(type: "integer", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramPhases", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramPhases_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramSkips",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgramId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    SkippedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramSkips", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramSkips_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Programs_Lifecycle",
                table: "Programs",
                sql: "\"LifecycleStatus\" IN ('standby','active','completed')");

            migrationBuilder.Sql("UPDATE \"Programs\" SET \"LifecycleStatus\" = CASE WHEN \"Active\" THEN 'active' ELSE 'standby' END;");

            migrationBuilder.CreateIndex(
                name: "IX_ProgramPhases_UserId_ProgramId_Position",
                table: "ProgramPhases",
                columns: new[] { "UserId", "ProgramId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramPhases_UserId_ProgramId_WeekFrom_WeekTo",
                table: "ProgramPhases",
                columns: new[] { "UserId", "ProgramId", "WeekFrom", "WeekTo" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramSkips_UserId_ProgramId_TemplateId",
                table: "ProgramSkips",
                columns: new[] { "UserId", "ProgramId", "TemplateId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramPhases");

            migrationBuilder.DropTable(
                name: "ProgramSkips");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Programs_Lifecycle",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "LifecycleStatus",
                table: "Programs");

            migrationBuilder.DropColumn(
                name: "TimeZone",
                table: "Programs");
        }
    }
}
