using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseWeightBasis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "WeightBasis",
                table: "Exercises",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "total");

            migrationBuilder.AddColumn<string>(
                name: "WeightBasis",
                table: "CustomExercises",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "total");

            // Explicitly audited catalog identities, including retained synonyms. No logged values change.
            migrationBuilder.Sql("""
                UPDATE "Exercises" SET "WeightBasis" = 'per_side' WHERE "Slug" IN ('dumbbell-walking-lunge', 'db-lunge', 'db-bulgarian-split-squat', 'pause-db-bulgarian-split-squat', 'dumbbell-step-up', 'db-romanian-deadlift', 'flat-db-press', 'flat-dumbbell-static-hold', 'db-bench-press', 'close-grip-db-incline-press', 'db-flye', 'low-incline-db-press', 'dumbbell-chest-press', 'cable-chest-press', '45-incline-db-press', 'dumbbell-floor-press', 'low-to-high-cable-flye', 'cable-flye-21s', 'cable-flye', 'bent-over-cable-pec-flye', 'cable-crossover-ladder', 'bottom-half-db-flye', 'low-incline-db-flye', 'low-to-high-cable-crossover', 'helms-db-row', 'incline-chest-supported-db-row', 'kroc-row', 'single-arm-db-row', 'chest-supported-db-row', 'elbows-in-1-arm-db-row', 'standing-db-arnold-press', 'seated-db-shoulder-press', 'arnold-press', 'db-curl', 'db-pronated-curl', 'db-bicep-curl', 'alternating-db-curl', 'supinated-dumbbell-curl', 'hammer-curl', 'incline-dumbbell-curl', 'db-preacher-curl', 'bench-braced-wrist-curl', 'dumbbell-wrist-curl', 'bench-braced-wrist-extension', 'dumbbell-wrist-extension', 'modified-zottman-curl', 'farmer-s-walk', 'db-skull-crusher', 'dual-cable-triceps-press', 'db-triceps-kickback', 'db-floor-skull-crusher', 'db-lateral-raise', 'incline-db-y-raise', 'cable-y-raise', 'reverse-cable-flye', 'bent-over-reverse-db-flye', 'lying-reverse-db-flye', 'reverse-cable-crossover', 'rear-delt-45-cable-flye', 'lean-in-db-lateral-raise', 'meadows-incline-db-lateral-raise', 'db-calf-jumps', 'single-leg-db-calf-raise', 'dumbbell-shrug', 'kelso-shrug', 'incline-db-kelso-shrug', 'seated-dumbbell-shrug', 'db-incline-press', 'dumbbell-row', 'spider-curl', 'cable-shoulder-press', 'zottman-curl', 'db-concentration-curl', 'incline-shrug', 'incline-dumbbell-lateral-hold', 'dumbbell-lateral-raise-isometric-hold', 'standing-dumbbell-press', '1-arm-dumbbell-upright-row', 'hammer-preacher-curl', 'prone-trap-raise', 'db-front-raise', 'db-rear-delt-swing', 'db-reverse-lunge', 'db-static-lunge', 'db-incline-curl', 'db-rdl', 'cable-reverse-flye', 'bent-over-dumbbell-reverse-flye');
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_WeightBasis",
                table: "Exercises",
                sql: "\"WeightBasis\" IN ('total','per_side')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomExercises_WeightBasis",
                table: "CustomExercises",
                sql: "\"WeightBasis\" IN ('total','per_side')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_WeightBasis",
                table: "Exercises");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomExercises_WeightBasis",
                table: "CustomExercises");

            migrationBuilder.DropColumn(
                name: "WeightBasis",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "WeightBasis",
                table: "CustomExercises");
        }
    }
}
