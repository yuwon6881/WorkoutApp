using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SessionProgramNameSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProgramNameSnapshot",
                table: "Workouts",
                type: "text",
                nullable: true);

            // Sessions whose program still exists get its current name; ones already orphaned have none to recover.
            migrationBuilder.Sql("""
                UPDATE "Workouts" w SET "ProgramNameSnapshot" = p."Name"
                FROM "Programs" p
                WHERE w."ProgramId" = p."Id" AND w."UserId" = p."UserId" AND w."ProgramNameSnapshot" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ProgramNameSnapshot",
                table: "Workouts");
        }
    }
}
