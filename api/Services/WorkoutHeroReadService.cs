using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record HeroMuscle(string Muscle, double Sets);
public sealed record WorkoutHeroView(Guid? TemplateId, Guid? SessionId, int? SessionRevision,
    string? CompletedStandaloneName, int? WorkingSets, List<HeroMuscle> Muscles);

/// Only the next day or open session needs catalog metadata at launch, never the full library.
public static class WorkoutHeroReadService
{
    private sealed record Planned(Guid? ExerciseId, string Name, int Sets);
    private sealed record Metadata(Guid Id, string Muscle, string SecondaryMusclesJson);

    public static async Task<WorkoutHeroView> Get(AppDb db, Guid? nextId, SessionView? session, CancellationToken ct)
    {
        var planned = new List<Planned>();
        string? completedName = null;
        if (session is { Active: true })
            planned.AddRange(session.Exercises.Select(row => new Planned(row.ExerciseId, row.Name, row.Sets.Count(set => !set.Warmup))));
        else if (nextId is { } id)
        {
            var rows = await db.TemplateExercises.AsNoTracking().Where(row => row.TemplateId == id)
                .Select(row => new { row.ExerciseId, row.SourceName, row.SetsJson }).ToListAsync(ct);
            planned.AddRange(rows.Select(row => new Planned(row.ExerciseId, row.SourceName,
                Json.Read<List<SetPrescription>>(row.SetsJson).Count(set => !set.Warmup))));
        }
        else
            completedName = await db.Templates.AsNoTracking()
                .Where(row => row.ProgramId == null && row.Active && row.ActiveCompletedAt != null)
                .Select(row => row.Name).FirstOrDefaultAsync(ct);

        var ids = planned.Where(row => row.ExerciseId.HasValue).Select(row => row.ExerciseId!.Value).Distinct().ToList();
        var catalog = await db.Exercises.AsNoTracking().Where(row => ids.Contains(row.Id))
            .Select(row => new Metadata(row.Id, row.Muscle, row.SecondaryMusclesJson)).ToListAsync(ct);
        var custom = await db.CustomExercises.AsNoTracking().Where(row => ids.Contains(row.Id))
            .Select(row => new Metadata(row.Id, row.Muscle, row.SecondaryMusclesJson)).ToListAsync(ct);
        var metadata = catalog.Concat(custom).ToDictionary(row => row.Id);
        var muscles = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var row in planned)
        {
            var exercise = row.ExerciseId is { } exerciseId ? metadata.GetValueOrDefault(exerciseId) : null;
            foreach (var credit in MuscleAttribution.For(row.Name, exercise?.Muscle,
                exercise is null ? [] : Json.Read<List<string>>(exercise.SecondaryMusclesJson)))
                muscles[credit.Region] = muscles.GetValueOrDefault(credit.Region) + credit.Weight * row.Sets;
        }
        return new WorkoutHeroView(nextId, session?.Id, session?.Revision, completedName,
            session is { Active: true } || nextId.HasValue ? planned.Sum(row => row.Sets) : null,
            muscles.Where(row => row.Value > 0).OrderByDescending(row => row.Value).ThenBy(row => row.Key)
                .Select(row => new HeroMuscle(row.Key, row.Value)).ToList());
    }
}
