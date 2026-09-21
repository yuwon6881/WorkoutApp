using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkoutRestAlertPush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WorkoutPushDevices",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    FcmToken = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutPushDevices", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_WorkoutPushDevices_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutRestAlertSchedules",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Generation = table.Column<Guid>(type: "uuid", nullable: false),
                    Deadline = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    TaskName = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutRestAlertSchedules", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_WorkoutRestAlertSchedules_Status", "\"Status\" IN ('pending','scheduled','dispatching','accepted','cancelled','disabled','expired','failed')");
                    table.ForeignKey(
                        name: "FK_WorkoutRestAlertSchedules_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WorkoutRestAlertSchedules_Workouts_UserId_SessionId",
                        columns: x => new { x.UserId, x.SessionId },
                        principalTable: "Workouts",
                        principalColumns: new[] { "UserId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutPushDevices_UserId_DeviceId",
                table: "WorkoutPushDevices",
                columns: new[] { "UserId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutRestAlertSchedules_Status_CreatedAt",
                table: "WorkoutRestAlertSchedules",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutRestAlertSchedules_Status_ExpiresAt",
                table: "WorkoutRestAlertSchedules",
                columns: new[] { "Status", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutRestAlertSchedules_UserId_SessionId_DeviceId_Generat~",
                table: "WorkoutRestAlertSchedules",
                columns: new[] { "UserId", "SessionId", "DeviceId", "Generation" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkoutPushDevices");

            migrationBuilder.DropTable(
                name: "WorkoutRestAlertSchedules");
        }
    }
}
