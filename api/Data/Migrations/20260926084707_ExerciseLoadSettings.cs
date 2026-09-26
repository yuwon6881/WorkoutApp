using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseLoadSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ExerciseLoadSettings",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LoadStepKg = table.Column<double>(type: "double precision", nullable: true),
                    AvailableLoadsJson = table.Column<string>(type: "text", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseLoadSettings", x => new { x.UserId, x.Id });
                    table.CheckConstraint("CK_ExerciseLoadSettings_Step", "\"LoadStepKg\" IS NULL OR (\"LoadStepKg\" >= 0 AND \"LoadStepKg\" <= 50)");
                    table.ForeignKey(
                        name: "FK_ExerciseLoadSettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseLoadSettings");
        }
    }
}
