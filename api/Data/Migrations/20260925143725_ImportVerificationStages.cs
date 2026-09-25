using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ImportVerificationStages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','select','extract','verify','recover','done','failed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"Imports\" SET \"Stage\" = CASE WHEN \"Stage\" IN ('verify','recover') THEN 'extract' WHEN \"Stage\" = 'failed' THEN 'done' ELSE \"Stage\" END");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Imports_Stage",
                table: "Imports",
                sql: "\"Stage\" IN ('outline','select','extract','done')");
        }
    }
}
