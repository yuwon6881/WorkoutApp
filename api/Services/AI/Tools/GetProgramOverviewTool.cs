using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetProgramOverviewTool : IAiTool
{
    private readonly AppDb _db;

    public GetProgramOverviewTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_program_overview";
    public string Description => "Read the active training slot: standalone workout, or program including finished-run state, current week, phases and templates.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject()
    };

    public string ProgressLabel(AiToolArgs args) => "Checking your active training program...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var standalone = await _db.Templates.AsNoTracking().Where(t => t.Active && t.ProgramId == null)
            .Select(t => new { id = t.Id.ToString(), name = t.Name, completed = t.ActiveCompletedAt != null }).FirstOrDefaultAsync(cancellationToken);
        if (standalone != null) context.Evidence.Record(AiEvidenceLedger.Template, standalone.id);
        var program = await _db.Programs.AsNoTracking()
            .Where(p => p.Active)
            .FirstOrDefaultAsync(cancellationToken);

        if (program == null)
        {
            return AiToolResult.Of(new
            {
                hasActiveProgram = false,
                activeStandalone = standalone,
                message = "No active program; activeStandalone identifies the active standalone workout when present."
            });
        }

        context.Evidence.Record(AiEvidenceLedger.Program, program.Id.ToString());

        var currentRun = await _db.ProgramRuns.AsNoTracking()
            .Where(r => r.ProgramId == program.Id)
            .OrderByDescending(r => r.Number)
            .FirstOrDefaultAsync(cancellationToken);

        var phases = await _db.ProgramPhases.AsNoTracking()
            .Where(p => p.ProgramId == program.Id)
            .OrderBy(p => p.Position)
            .Select(p => new
            {
                name = p.Name,
                block = p.Block,
                weekFrom = p.WeekFrom,
                weekTo = p.WeekTo,
                durationWeeks = p.DurationWeeks
            })
            .ToListAsync(cancellationToken);

        var currentWeek = currentRun?.CurrentWeek ?? 1;

        var templates = await _db.Templates.AsNoTracking()
            .Where(t => t.ProgramId == program.Id && t.Week == currentWeek)
            .OrderBy(t => t.Position)
            .Select(t => new
            {
                id = t.Id.ToString(),
                name = t.Name,
                focus = t.Focus,
                isRestDay = t.IsRestDay,
                position = t.Position
            })
            .ToListAsync(cancellationToken);

        foreach (var t in templates)
        {
            context.Evidence.Record(AiEvidenceLedger.Template, t.id);
        }

        return AiToolResult.Of(new
        {
            hasActiveProgram = true,
            programId = program.Id.ToString(),
            programName = program.Name,
            totalWeeks = program.Weeks,
            lifecycleStatus = program.LifecycleStatus,
            runCompleted = currentRun?.CompletedAt != null,
            activeStandalone = standalone,
            currentWeek,
            runNumber = currentRun?.Number ?? 1,
            phases,
            currentWeekTemplates = templates
        });
    }
}
