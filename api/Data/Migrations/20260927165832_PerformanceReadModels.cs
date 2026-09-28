using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PerformanceReadModels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ResourceGenerations",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Programs = table.Column<long>(type: "bigint", nullable: false),
                    Templates = table.Column<long>(type: "bigint", nullable: false),
                    Sessions = table.Column<long>(type: "bigint", nullable: false),
                    Imports = table.Column<long>(type: "bigint", nullable: false),
                    Progress = table.Column<long>(type: "bigint", nullable: false),
                    CustomExercises = table.Column<long>(type: "bigint", nullable: false),
                    ExerciseLoads = table.Column<long>(type: "bigint", nullable: false),
                    Preferences = table.Column<long>(type: "bigint", nullable: false),
                    History = table.Column<long>(type: "bigint", nullable: false),
                    HistoryAppendId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ResourceGenerations", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_ResourceGenerations_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TrainingReadModels",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Generation = table.Column<long>(type: "bigint", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Json = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingReadModels", x => new { x.UserId, x.Kind, x.SourceId });
                    table.ForeignKey(
                        name: "FK_TrainingReadModels_Users_UserId",
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
                name: "ResourceGenerations");

            migrationBuilder.DropTable(
                name: "TrainingReadModels");
        }
    }
}
