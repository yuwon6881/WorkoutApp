using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record SeedExercise(string Slug, string Name, string Muscle, string Equipment, string Cue, List<string>? Aliases,
    double? LoadStepKg = null, string LoadModel = LoadModels.External);

/// The catalog changes only here. Seeding is keyed by slug, so re-running the same file
/// updates rows in place instead of creating duplicates, and leaves omitted exercises alone.
public static class CatalogSeed
{
    public static async Task<string> Run(AppDb db, string path, bool deactivateMissing, CancellationToken ct)
    {
        Validation.Require(File.Exists(path), $"Seed file not found: {path}", 400);
        var input = Json.Read<List<SeedExercise>>(await File.ReadAllTextAsync(path, ct));
        return await Apply(db, input, deactivateMissing, ct);
    }

    public static async Task<string> Apply(AppDb db, List<SeedExercise> input, bool deactivateMissing, CancellationToken ct)
    {
        Validation.Require(input.Count > 0, "The seed file contains no exercises.");
        foreach (var row in input)
        {
            Validation.Name(row.Slug, "Exercise slug", 120);
            Validation.Require(row.Slug.All(c => char.IsAsciiLetterOrDigit(c) || c is '-'), $"Slug '{row.Slug}' may use letters, digits, and hyphens only.");
            Validation.Name(row.Name, "Exercise name", 160);
            Validation.Text(row.Muscle, 60, "Muscle"); Validation.Text(row.Equipment, 60, "Equipment"); Validation.Text(row.Cue, 600, "Cue");
            if (row.LoadStepKg is { } step) Validation.Number(step, 0, 50, "Load step");
            Validation.Require(LoadModels.All.Contains(row.LoadModel), "Unknown exercise load model.");
        }
        Validation.Require(input.Select(r => r.Slug).Distinct(StringComparer.OrdinalIgnoreCase).Count() == input.Count, "The seed file repeats a slug.");

        db.MaintenanceAccess = true;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var existing = await db.Exercises.ToListAsync(ct);
        var added = 0; var updated = 0;
        foreach (var row in input)
        {
            var exercise = existing.FirstOrDefault(x => x.Slug == row.Slug);
            if (exercise == null) { exercise = new Exercise { Slug = row.Slug }; db.Exercises.Add(exercise); added++; }
            else updated++;
            exercise.Name = row.Name.Trim(); exercise.Muscle = row.Muscle ?? ""; exercise.Equipment = row.Equipment ?? ""; exercise.Cue = row.Cue ?? ""; exercise.Active = true;
            // The seed may state the smallest jump a gym actually has; otherwise equipment decides.
            exercise.LoadStepKg = row.LoadStepKg ?? (row.LoadModel == LoadModels.FullBodyweight
                ? Progression.DefaultStepKg
                : Progression.StepForEquipment(row.Equipment));
            exercise.LoadModel = row.LoadModel;
        }
        var deactivated = 0;
        if (deactivateMissing)
            foreach (var exercise in existing.Where(x => x.Active && !input.Any(r => r.Slug == x.Slug))) { exercise.Active = false; deactivated++; }
        await db.SaveChangesAsync(ct);

        // Aliases are replaced wholesale per seeded exercise so a removed alias actually disappears.
        var slugs = input.Select(r => r.Slug).ToList();
        var seeded = await db.Exercises.Where(x => slugs.Contains(x.Slug)).ToListAsync(ct);
        var ids = seeded.Select(x => x.Id).ToList();
        db.Aliases.RemoveRange(await db.Aliases.Where(a => ids.Contains(a.ExerciseId)).ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        var aliasCount = 0;
        var claimed = new HashSet<string>();
        foreach (var row in input)
        {
            var exercise = seeded.Single(x => x.Slug == row.Slug);
            foreach (var alias in (row.Aliases ?? []).Concat([row.Name]))
            {
                var normalized = CatalogService.Normalize(alias);
                if (normalized.Length == 0 || !claimed.Add(normalized)) continue;
                db.Aliases.Add(new ExerciseAlias { ExerciseId = exercise.Id, Normalized = normalized, Alias = alias.Trim() });
                aliasCount++;
            }
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        db.MaintenanceAccess = false;
        return $"Seeded {input.Count} exercises: {added} added, {updated} updated, {deactivated} deactivated, {aliasCount} aliases.";
    }
}
