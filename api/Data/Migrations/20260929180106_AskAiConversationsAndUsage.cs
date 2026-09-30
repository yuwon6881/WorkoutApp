using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AskAiConversationsAndUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "ChatCachedTokens",
                table: "Usage",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "ChatCalls",
                table: "Usage",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<long>(
                name: "ChatInputTokens",
                table: "Usage",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "ChatOutputTokens",
                table: "Usage",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "ChatReasoningTokens",
                table: "Usage",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "Usage",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.CreateTable(
                name: "AiConversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    StateJson = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiConversations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiConversations_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AiConversationTurns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientTurnId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    AssistantReply = table.Column<string>(type: "text", nullable: false),
                    ActionsJson = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActionsResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ActionsDismissedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CloseChat = table.Column<bool>(type: "boolean", nullable: false),
                    Intent = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Topic = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    FacetsJson = table.Column<string>(type: "text", nullable: true),
                    KeywordsJson = table.Column<string>(type: "text", nullable: true),
                    ToolTraceJson = table.Column<string>(type: "text", nullable: true),
                    ConversationVersion = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiConversationTurns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiConversationTurns_AiConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "AiConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AiConversationTurns_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiConversations_UserId",
                table: "AiConversations",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AiConversationTurns_ConversationId_ClientTurnId",
                table: "AiConversationTurns",
                columns: new[] { "ConversationId", "ClientTurnId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AiConversationTurns_ConversationId_CreatedAt",
                table: "AiConversationTurns",
                columns: new[] { "ConversationId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_AiConversationTurns_UserId",
                table: "AiConversationTurns",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiConversationTurns");

            migrationBuilder.DropTable(
                name: "AiConversations");

            migrationBuilder.DropColumn(
                name: "ChatCachedTokens",
                table: "Usage");

            migrationBuilder.DropColumn(
                name: "ChatCalls",
                table: "Usage");

            migrationBuilder.DropColumn(
                name: "ChatInputTokens",
                table: "Usage");

            migrationBuilder.DropColumn(
                name: "ChatOutputTokens",
                table: "Usage");

            migrationBuilder.DropColumn(
                name: "ChatReasoningTokens",
                table: "Usage");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "Usage");
        }
    }
}
