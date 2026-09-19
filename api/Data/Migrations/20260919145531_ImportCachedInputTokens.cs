using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ImportCachedInputTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CachedInputTokens",
                table: "Imports",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CachedInputTokens",
                table: "Imports");
        }
    }
}
