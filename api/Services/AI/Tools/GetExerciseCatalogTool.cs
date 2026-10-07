using System.Text.Json.Nodes;
using Workout.Api.Data;

namespace Workout.Api.Services.AI.Tools;

public sealed class GetExerciseCatalogTool : IAiTool
{
    private readonly AppDb _db;

    public GetExerciseCatalogTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_exercise_catalog";
    public string Description => "Search the exercise catalog by keyword, muscle group, equipment, or category.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["query"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Search text for exercise name (e.g. 'squat', 'curl', 'press')."
            },
            ["muscle"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Filter by primary muscle group (e.g. 'Chest', 'Back', 'Quads', 'Hamstrings', 'Shoulders', 'Triceps', 'Biceps')."
            },
            ["equipment"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Filter by equipment (e.g. 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight')."
            },
            ["category"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Filter by category: Free Weights, Machine, or Body Weight."
            },
            ["limit"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Maximum results to return (1-25, default 10)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Searching exercise catalog...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var query = args.OptionalString("query", 100);
        var muscle = args.OptionalString("muscle", 60);
        var equipment = args.OptionalString("equipment", 60);
        var category = args.OptionalString("category", 60);
        var limit = args.OptionalInt("limit", 1, 25) ?? 10;

        // Use the app's canonical catalog, including account-owned exercises and normalized metadata.
        IEnumerable<CatalogExercise> catalogQuery = await new CatalogService(_db).All(cancellationToken);

        if (!string.IsNullOrWhiteSpace(query))
        {
            var q = CatalogService.Normalize(query);
            catalogQuery = catalogQuery.Where(e => CatalogService.Normalize(e.Name).Contains(q)
                || CatalogService.Normalize(e.Slug).Contains(q)
                || e.Aliases.Any(a => CatalogService.Normalize(a).Contains(q)));
        }
        if (!string.IsNullOrWhiteSpace(muscle))
        {
            catalogQuery = catalogQuery.Where(e => e.Muscle.Equals(muscle, StringComparison.OrdinalIgnoreCase)
                || e.SecondaryMuscles?.Any(m => m.Equals(muscle, StringComparison.OrdinalIgnoreCase)) == true);
        }
        if (!string.IsNullOrWhiteSpace(equipment))
        {
            catalogQuery = catalogQuery.Where(e => e.Equipment.Equals(equipment, StringComparison.OrdinalIgnoreCase));
        }
        if (!string.IsNullOrWhiteSpace(category))
            catalogQuery = catalogQuery.Where(e => e.Category.Equals(category, StringComparison.OrdinalIgnoreCase));

        var matches = catalogQuery
            .OrderBy(e => e.Name)
            .Take(limit + 1).ToList();
        var results = matches.Take(limit)
            .Select(e => new
            {
                id = e.Id.ToString(),
                slug = e.Slug,
                name = e.Name,
                muscle = e.Muscle,
                equipment = e.Equipment,
                category = e.Category,
                loadModel = e.LoadModel,
                trackingMode = e.TrackingMode,
                isCustom = e.IsCustom
            })
            .ToList();

        foreach (var r in results)
        {
            context.Evidence.Record(AiEvidenceLedger.Exercise, r.id);
            context.Evidence.Record(AiEvidenceLedger.Exercise, r.slug);
        }

        return AiToolResult.Of(new
        {
            count = results.Count,
            exercises = results
        }, truncated: matches.Count > limit);
    }
}
