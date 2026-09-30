using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AskAiReviewSafety : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Usage_Date",
                table: "Usage",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_AiConversationTurns_CreatedAt",
                table: "AiConversationTurns",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Usage_Date",
                table: "Usage");

            migrationBuilder.DropIndex(
                name: "IX_AiConversationTurns_CreatedAt",
                table: "AiConversationTurns");
        }
    }
}
