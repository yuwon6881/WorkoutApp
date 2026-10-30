using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GymProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_ExerciseLoadSettings",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentLoadDefaults_UserId_Equipment",
                table: "EquipmentLoadDefaults");

            migrationBuilder.AddColumn<Guid>(
                name: "GymProfileId",
                table: "Workouts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ActiveGymProfileId",
                table: "Users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequiresJson",
                table: "Exercises",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<Guid>(
                name: "GymProfileId",
                table: "ExerciseLoadSettings",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "GymProfileId",
                table: "EquipmentLoadDefaults",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddPrimaryKey(
                name: "PK_ExerciseLoadSettings",
                table: "ExerciseLoadSettings",
                columns: new[] { "UserId", "GymProfileId", "Id" });

            migrationBuilder.CreateTable(
                name: "GymProfiles",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    MissingEquipmentJson = table.Column<string>(type: "text", nullable: false, defaultValue: "[]"),
                    ExerciseOverridesJson = table.Column<string>(type: "text", nullable: false, defaultValue: "{}"),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GymProfiles", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_GymProfiles_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Every existing account gets one gym holding the weights it already set, and its
            // past workouts are recorded there so machine history keeps progressing.
            migrationBuilder.Sql("""
                INSERT INTO "GymProfiles" ("UserId", "Id", "Name", "MissingEquipmentJson", "ExerciseOverridesJson", "CreatedAt", "Revision")
                SELECT "Id", gen_random_uuid(), 'My gym', '[]', '{}', now(), 1 FROM "Users";
                UPDATE "Users" AS u SET "ActiveGymProfileId" = g."Id" FROM "GymProfiles" AS g WHERE g."UserId" = u."Id";
                UPDATE "ExerciseLoadSettings" AS s SET "GymProfileId" = g."Id" FROM "GymProfiles" AS g WHERE g."UserId" = s."UserId";
                UPDATE "EquipmentLoadDefaults" AS d SET "GymProfileId" = g."Id" FROM "GymProfiles" AS g WHERE g."UserId" = d."UserId";
                UPDATE "Workouts" AS w SET "GymProfileId" = g."Id" FROM "GymProfiles" AS g WHERE g."UserId" = w."UserId";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentLoadDefaults_UserId_GymProfileId_Equipment",
                table: "EquipmentLoadDefaults",
                columns: new[] { "UserId", "GymProfileId", "Equipment" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_EquipmentLoadDefaults_GymProfiles_UserId_GymProfileId",
                table: "EquipmentLoadDefaults",
                columns: new[] { "UserId", "GymProfileId" },
                principalTable: "GymProfiles",
                principalColumns: new[] { "UserId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_ExerciseLoadSettings_GymProfiles_UserId_GymProfileId",
                table: "ExerciseLoadSettings",
                columns: new[] { "UserId", "GymProfileId" },
                principalTable: "GymProfiles",
                principalColumns: new[] { "UserId", "Id" },
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // One rule per exercise and equipment type survives: the active gym's.
            migrationBuilder.Sql("""
                DELETE FROM "ExerciseLoadSettings" AS s USING "Users" AS u
                WHERE u."Id" = s."UserId" AND s."GymProfileId" IS DISTINCT FROM u."ActiveGymProfileId";
                DELETE FROM "EquipmentLoadDefaults" AS d USING "Users" AS u
                WHERE u."Id" = d."UserId" AND d."GymProfileId" IS DISTINCT FROM u."ActiveGymProfileId";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_EquipmentLoadDefaults_GymProfiles_UserId_GymProfileId",
                table: "EquipmentLoadDefaults");

            migrationBuilder.DropForeignKey(
                name: "FK_ExerciseLoadSettings_GymProfiles_UserId_GymProfileId",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropTable(
                name: "GymProfiles");

            migrationBuilder.DropPrimaryKey(
                name: "PK_ExerciseLoadSettings",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentLoadDefaults_UserId_GymProfileId_Equipment",
                table: "EquipmentLoadDefaults");

            migrationBuilder.DropColumn(
                name: "GymProfileId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "ActiveGymProfileId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "RequiresJson",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "GymProfileId",
                table: "ExerciseLoadSettings");

            migrationBuilder.DropColumn(
                name: "GymProfileId",
                table: "EquipmentLoadDefaults");

            migrationBuilder.AddPrimaryKey(
                name: "PK_ExerciseLoadSettings",
                table: "ExerciseLoadSettings",
                columns: new[] { "UserId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentLoadDefaults_UserId_Equipment",
                table: "EquipmentLoadDefaults",
                columns: new[] { "UserId", "Equipment" },
                unique: true);
        }
    }
}
