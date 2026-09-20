using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GoogleHealthSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GoogleHealthConnections",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    GoogleIdHash = table.Column<string>(type: "text", nullable: false),
                    EncryptedGoogleId = table.Column<string>(type: "text", nullable: false),
                    EncryptedRefreshToken = table.Column<string>(type: "text", nullable: false),
                    EncryptedStepHistoryJson = table.Column<string>(type: "text", nullable: false),
                    GrantedScopesJson = table.Column<string>(type: "text", nullable: false),
                    WorkoutSyncEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    WorkoutSyncRevision = table.Column<long>(type: "bigint", nullable: false),
                    WorkoutLastSuccessfulSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ConnectionGeneration = table.Column<long>(type: "bigint", nullable: false),
                    ConnectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthConnections", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_GoogleHealthConnections_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GoogleHealthOAuthStates",
                columns: table => new
                {
                    State = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionHash = table.Column<string>(type: "text", nullable: false),
                    RequestedOperationsJson = table.Column<string>(type: "text", nullable: false),
                    RequestedScopesJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthOAuthStates", x => x.State);
                    table.ForeignKey(
                        name: "FK_GoogleHealthOAuthStates_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GoogleHealthWorkoutSyncWork",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    DesiredRevision = table.Column<long>(type: "bigint", nullable: false),
                    DesiredStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DesiredFinishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DesiredName = table.Column<string>(type: "text", nullable: false),
                    DesiredNotes = table.Column<string>(type: "text", nullable: false),
                    DesiredDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    GoogleIdHash = table.Column<string>(type: "text", nullable: false),
                    ConnectionGeneration = table.Column<long>(type: "bigint", nullable: false),
                    GoogleResourceName = table.Column<string>(type: "text", nullable: false),
                    GoogleOperationName = table.Column<string>(type: "text", nullable: false),
                    ProcessingState = table.Column<string>(type: "text", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LeaseId = table.Column<string>(type: "text", nullable: false),
                    LastErrorCategory = table.Column<string>(type: "text", nullable: false),
                    LastErrorMessage = table.Column<string>(type: "text", nullable: false),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    LastSuccessfulSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthWorkoutSyncWork", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_GoogleHealthWorkoutSyncWork_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthConnections_GoogleIdHash",
                table: "GoogleHealthConnections",
                column: "GoogleIdHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthOAuthStates_ExpiresAt",
                table: "GoogleHealthOAuthStates",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthOAuthStates_UserId",
                table: "GoogleHealthOAuthStates",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthWorkoutSyncWork_ProcessingState_NextAttemptAt",
                table: "GoogleHealthWorkoutSyncWork",
                columns: new[] { "ProcessingState", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthWorkoutSyncWork_UserId_WorkoutSessionId",
                table: "GoogleHealthWorkoutSyncWork",
                columns: new[] { "UserId", "WorkoutSessionId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleHealthConnections");

            migrationBuilder.DropTable(
                name: "GoogleHealthOAuthStates");

            migrationBuilder.DropTable(
                name: "GoogleHealthWorkoutSyncWork");
        }
    }
}
