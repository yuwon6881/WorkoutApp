using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "Exercises",
                type: "text",
                nullable: false,
                defaultValue: "Free Weights");

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "CustomExercises",
                type: "text",
                nullable: false,
                defaultValue: "Free Weights");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_Category",
                table: "Exercises",
                sql: "\"Category\" IN ('Free Weights','Machine','Body Weight')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomExercises_Category",
                table: "CustomExercises",
                sql: "\"Category\" IN ('Free Weights','Machine','Body Weight')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_Category",
                table: "Exercises");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomExercises_Category",
                table: "CustomExercises");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "CustomExercises");
        }
    }
}
