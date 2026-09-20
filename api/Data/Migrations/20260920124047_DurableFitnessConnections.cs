using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Workout.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DurableFitnessConnections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CentralConnectionGeneration",
                table: "IntegrationGrants",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CentralConnectionId",
                table: "IntegrationGrants",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CentralConnectionGeneration",
                table: "IntegrationGrants");

            migrationBuilder.DropColumn(
                name: "CentralConnectionId",
                table: "IntegrationGrants");
        }
    }
}
