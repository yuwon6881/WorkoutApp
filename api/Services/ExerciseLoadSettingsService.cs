using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ExerciseLoadSettingsInput(double? LoadStepKg, List<double>? AvailableLoadsKg, int Revision);
public record ExerciseLoadSettingsView(double LoadStepKg, List<double>? AvailableLoadsKg,
    double DefaultStepKg, bool IsCustomized, int Revision);

public sealed class ExerciseLoadSettingsService(AppDb db)
{
    public async Task<ExerciseLoadSettingsView> Get(Guid id, CancellationToken ct)
    {
        var step = await DefaultStep(id, ct);
        var row = await db.ExerciseLoadSettings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        return View(row, step);
    }

    public async Task<ExerciseLoadSettingsView> Save(Guid id, ExerciseLoadSettingsInput input, CancellationToken ct)
    {
        Validation.Require(input.LoadStepKg is null || input.AvailableLoadsKg is null,
            "Choose a fixed increment or available weights, not both.");
        if (input.LoadStepKg is { } step) Validation.Number(step, 0, 50, "Weight increment");
        List<double>? weights = null;
        if (input.AvailableLoadsKg is { } values)
        {
            Validation.Require(values.Count is >= 2 and <= 200, "Enter between 2 and 200 available weights.");
            foreach (var weight in values) Validation.Number(weight, 0, 1000, "Available weight");
            weights = values.Distinct().Order().ToList();
            Validation.Require(weights.Count >= 2, "Enter at least two different available weights.");
        }
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var defaultStep = await DefaultStep(id, ct);
        var row = await db.ExerciseLoadSettings.SingleOrDefaultAsync(x => x.Id == id, ct);
        Validation.Require(input.Revision == (row?.Revision ?? 0),
            "These weight settings changed elsewhere. Reload them before saving again.", 409);
        if (row is null)
        {
            row = new ExerciseLoadSetting { UserId = db.CurrentUser!.Value, Id = id };
            db.ExerciseLoadSettings.Add(row);
        }
        row.LoadStepKg = input.LoadStepKg;
        row.AvailableLoadsJson = weights is null ? null : Json.Write(weights);
        row.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return View(row, defaultStep);
    }

    private async Task<double> DefaultStep(Guid id, CancellationToken ct)
    {
        var step = await db.Exercises.Where(x => x.Id == id && x.Active).Select(x => (double?)x.LoadStepKg).SingleOrDefaultAsync(ct)
            ?? await db.CustomExercises.Where(x => x.Id == id && !x.Archived).Select(x => (double?)x.LoadStepKg).SingleOrDefaultAsync(ct);
        Validation.Require(step is not null, "That exercise is no longer available.", 404);
        return step!.Value;
    }

    private static ExerciseLoadSettingsView View(ExerciseLoadSetting? row, double defaultStep)
        => new(row?.LoadStepKg ?? defaultStep,
            row?.AvailableLoadsJson is { } json ? Json.Read<List<double>>(json) : null,
            defaultStep, row?.LoadStepKg is not null || row?.AvailableLoadsJson is not null, row?.Revision ?? 0);
}
