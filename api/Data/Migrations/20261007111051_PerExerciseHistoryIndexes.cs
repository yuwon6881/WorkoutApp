using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PerExerciseHistoryIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_WorkoutRestAlertSchedules_Id",
                table: "WorkoutRestAlertSchedules",
                column: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_SessionExercises_UserId_ExerciseId",
                table: "SessionExercises",
                columns: new[] { "UserId", "ExerciseId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WorkoutRestAlertSchedules_Id",
                table: "WorkoutRestAlertSchedules");

            migrationBuilder.DropIndex(
                name: "IX_SessionExercises_UserId_ExerciseId",
                table: "SessionExercises");
        }
    }
}
