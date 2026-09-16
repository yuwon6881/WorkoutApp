using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseSubstitutions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProgramPhaseId",
                table: "Templates",
                type: "uuid",
                nullable: true);

            // Existing imported programs already have durable phase rows. Link an unambiguous
            // template to that row so repeated phase names cannot be used as a substitution key.
            migrationBuilder.Sql("UPDATE \"Templates\" t SET \"ProgramPhaseId\" = p.\"Id\" FROM \"ProgramPhases\" p WHERE t.\"ProgramId\" = p.\"ProgramId\" AND t.\"Week\" BETWEEN p.\"WeekFrom\" AND p.\"WeekTo\" AND t.\"Block\" = p.\"Block\" AND (t.\"Phase\" = p.\"Name\" OR (t.\"Phase\" = '' AND p.\"Name\" = p.\"Block\"));");

            migrationBuilder.AddColumn<Guid>(
                name: "SlotKey",
                table: "TemplateExercises",
                type: "uuid",
                nullable: true);

            // Existing rows need independent keys before the unique index is created. md5 is
            // deterministic and available in every supported PostgreSQL deployment, so rerunning
            // a guarded migration cannot create a different identity for completed history.
            migrationBuilder.Sql("UPDATE \"TemplateExercises\" SET \"SlotKey\" = md5(\"UserId\"::text || ':' || \"Id\"::text)::uuid WHERE \"SlotKey\" IS NULL;");
            migrationBuilder.AlterColumn<Guid>(
                name: "SlotKey",
                table: "TemplateExercises",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsReplacement",
                table: "SessionExercises",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "OriginalExerciseId",
                table: "SessionExercises",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OriginalNameSnapshot",
                table: "SessionExercises",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "SourcePhaseId",
                table: "SessionExercises",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceSlotKey",
                table: "SessionExercises",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceTemplateExerciseId",
                table: "SessionExercises",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SwapGroupKey",
                table: "SessionExercises",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MovementPattern",
                table: "Exercises",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "ExerciseSubstitutions",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTemplateExerciseId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceSlotKey = table.Column<Guid>(type: "uuid", nullable: true),
                    SourcePhaseId = table.Column<Guid>(type: "uuid", nullable: true),
                    OriginalExerciseId = table.Column<Guid>(type: "uuid", nullable: true),
                    OriginalName = table.Column<string>(type: "text", nullable: false),
                    ReplacementExerciseId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReplacementName = table.Column<string>(type: "text", nullable: false),
                    Scope = table.Column<string>(type: "text", nullable: false),
                    PendingRetention = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RetainedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseSubstitutions", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_ExerciseSubstitutions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Templates_UserId_ProgramId_ProgramPhaseId",
                table: "Templates",
                columns: new[] { "UserId", "ProgramId", "ProgramPhaseId" });

            migrationBuilder.CreateIndex(
                name: "IX_TemplateExercises_UserId_TemplateId_SlotKey",
                table: "TemplateExercises",
                columns: new[] { "UserId", "TemplateId", "SlotKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SessionExercises_UserId_SessionId_SourceSlotKey",
                table: "SessionExercises",
                columns: new[] { "UserId", "SessionId", "SourceSlotKey" });

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseSubstitutions_UserId_SessionId_PendingRetention",
                table: "ExerciseSubstitutions",
                columns: new[] { "UserId", "SessionId", "PendingRetention" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseSubstitutions");

            migrationBuilder.DropIndex(
                name: "IX_Templates_UserId_ProgramId_ProgramPhaseId",
                table: "Templates");

            migrationBuilder.DropIndex(
                name: "IX_TemplateExercises_UserId_TemplateId_SlotKey",
                table: "TemplateExercises");

            migrationBuilder.DropIndex(
                name: "IX_SessionExercises_UserId_SessionId_SourceSlotKey",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "ProgramPhaseId",
                table: "Templates");

            migrationBuilder.DropColumn(
                name: "SlotKey",
                table: "TemplateExercises");

            migrationBuilder.DropColumn(
                name: "IsReplacement",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "OriginalExerciseId",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "OriginalNameSnapshot",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "SourcePhaseId",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "SourceSlotKey",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "SourceTemplateExerciseId",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "SwapGroupKey",
                table: "SessionExercises");

            migrationBuilder.DropColumn(
                name: "MovementPattern",
                table: "Exercises");
        }
    }
}
