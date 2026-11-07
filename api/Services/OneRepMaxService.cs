using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// OverrideKg is what the lifter typed; EstimatedKg comes from their recent heavy sets. EffectiveKg is
/// the one a percentage-based program uses (the typed value first).
public record OneRepMaxView(double? OverrideKg, double? EstimatedKg, double? EffectiveKg);

/// A null OneRepMaxKg clears the typed value so the estimate applies again.
public record OneRepMaxInput(double? OneRepMaxKg);

public sealed class OneRepMaxService(AppDb db, WorkoutService workouts)
{
    public static async Task<Dictionary<Guid, double>> Overrides(AppDb db, IEnumerable<Guid?> exerciseIds, CancellationToken ct)
    {
        var ids = exerciseIds.OfType<Guid>().Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.ExerciseOneRepMaxes.AsNoTracking().Where(row => ids.Contains(row.Id))
            .ToDictionaryAsync(row => row.Id, row => row.OneRepMaxKg, ct);
    }

    public async Task<OneRepMaxView> Get(Guid id, CancellationToken ct)
    {
        var name = await Name(id, ct);
        var typed = (await Overrides(db, [id], ct)).TryGetValue(id, out var kg) ? (double?)kg : null;
        var history = await workouts.PreviousExposures(id, name, ct);
        var estimate = PercentageLoad.EstimateOneRepMax(history.Values.SelectMany(exposures => exposures));
        return new OneRepMaxView(typed, estimate, typed ?? estimate);
    }

    public async Task<OneRepMaxView> Save(Guid id, OneRepMaxInput input, CancellationToken ct)
    {
        if (input.OneRepMaxKg is { } value)
            Validation.Require(double.IsFinite(value) && value > 0 && value <= 1000, "A one-rep max must be above 0 and at most 1000 kg.", 422);
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        await Name(id, ct);
        var row = await db.ExerciseOneRepMaxes.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (input.OneRepMaxKg is not { } kg)
        {
            if (row is not null) db.ExerciseOneRepMaxes.Remove(row);
        }
        else
        {
            if (row is null)
            {
                row = new ExerciseOneRepMax { UserId = db.CurrentUser!.Value, Id = id };
                db.ExerciseOneRepMaxes.Add(row);
            }
            row.OneRepMaxKg = kg;
            row.Revision++;
        }
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await Get(id, ct);
    }

    private async Task<string> Name(Guid id, CancellationToken ct)
    {
        var name = await db.Exercises.Where(x => x.Id == id && x.Active).Select(x => x.Name).SingleOrDefaultAsync(ct)
            ?? await db.CustomExercises.Where(x => x.Id == id).Select(x => x.Name).SingleOrDefaultAsync(ct);
        Validation.Require(name is not null, "That exercise is not in your library.", 404);
        return name!;
    }
}
