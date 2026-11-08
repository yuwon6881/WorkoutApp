using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExternalProgramEffort : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowUnspecifiedEffort",
                table: "Programs",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AllowUnspecifiedEffort",
                table: "Programs");
        }
    }
}
