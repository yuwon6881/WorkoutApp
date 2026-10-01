using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UnitTaggedLoadSteps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LoadStepUnit",
                table: "ExerciseLoadSettings",
                type: "text",
                nullable: false,
                defaultValue: "kg");

            migrationBuilder.AddColumn<string>(
                name: "LoadStepUnit",
                table: "EquipmentLoadDefaults",
                type: "text",
                nullable: false,
                defaultValue: "kg");

            migrationBuilder.AddColumn<string>(
                name: "LoadStepUnit",
                table: "CustomExercises",
                type: "text",
                nullable: false,
                defaultValue: "kg");

            // Existing steps were typed in, or converted on every switch to, the owner's current
            // unit, so that unit is the one each stored step means.
            foreach (var table in new[] { "ExerciseLoadSettings", "EquipmentLoadDefaults", "CustomExercises" })
            {
                migrationBuilder.Sql($"""
                    UPDATE "{table}"
                    SET "LoadStepUnit" = COALESCE(
                        (SELECT u."Unit" FROM "Users" u WHERE u."Id" = "{table}"."UserId"), 'kg');
                    """);
            }

            migrationBuilder.AddCheckConstraint(
                name: "CK_ExerciseLoadSettings_LoadStepUnit",
                table: "ExerciseLoadSettings",
                sql: "\"LoadStepUnit\" IN ('kg','lb')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_EquipmentLoadDefaults_LoadStepUnit",
                table: "EquipmentLoadDefaults",
                sql: "\"LoadStepUnit\" IN ('kg','lb')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomExercises_LoadStepUnit",
                table: "CustomExercises",
                sql: "\"LoadStepUnit\" IN ('kg','lb')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ExerciseLoadSettings_LoadStepUnit",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropCheckConstraint(
                name: "CK_EquipmentLoadDefaults_LoadStepUnit",
                table: "EquipmentLoadDefaults");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomExercises_LoadStepUnit",
                table: "CustomExercises");

            migrationBuilder.DropColumn(
                name: "LoadStepUnit",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropColumn(
                name: "LoadStepUnit",
                table: "EquipmentLoadDefaults");

            migrationBuilder.DropColumn(
                name: "LoadStepUnit",
                table: "CustomExercises");
        }
    }
}
