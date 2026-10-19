using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GoogleHealthConsentHandoff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HandoffVerifierHash",
                table: "GoogleHealthOAuthStates",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PendingCode",
                table: "GoogleHealthOAuthStates",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PendingError",
                table: "GoogleHealthOAuthStates",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HandoffVerifierHash",
                table: "GoogleHealthOAuthStates");

            migrationBuilder.DropColumn(
                name: "PendingCode",
                table: "GoogleHealthOAuthStates");

            migrationBuilder.DropColumn(
                name: "PendingError",
                table: "GoogleHealthOAuthStates");
        }
    }
}
