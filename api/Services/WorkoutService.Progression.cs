using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    private SetProgressionSuggestion MakeSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight, IReadOnlyList<double>? availableLoads = null)
    {
        // History must describe the same resistance convention. Bodyweight modes are
        // comparable through their frozen total system load; external modes are not.
        exposures = exposures.Where(exposure => loadModel == LoadModels.FullBodyweight
            ? exposure.ResistanceMode is ResistanceModes.Bodyweight or ResistanceModes.Added or ResistanceModes.Assistance
            : exposure.ResistanceMode == resistanceMode).ToList();
        if (loadModel == LoadModels.FullBodyweight)
        {
            var reference = bodyWeight?.ReferenceKg;
            var loads = resistanceMode switch
            {
                ResistanceModes.Added when reference is { } weight => new LoadOptions(step, weight, weight, weight + 1000,
                    availableLoads?.Select(load => weight + load).ToList()),
                ResistanceModes.Assistance when reference is { } weight => new LoadOptions(step, weight, 0, weight,
                    availableLoads?.Select(load => Math.Max(0, weight - load)).Distinct().Order().ToList()),
                _ => new LoadOptions(0)
            };
            var baseSuggestion = Progression.Suggest(prescription,
                exposures, mode, loads, context.Context?.Revision, resistanceMode,
                // A historical full-bodyweight set without a frozen snapshot cannot support a
                // system-load calculation. Never reinterpret its entered added/assistance load
                // as kilograms of total resistance.
                exposure => exposure.SystemLoadKg);
            var system = baseSuggestion.SuggestedLoadKg;
            var input = ToInputLoad(system, bodyWeight?.ReferenceKg, resistanceMode, availableLoads is null ? step : 0);
            var actualSystem = RecomputeSystemLoad(input, bodyWeight?.ReferenceKg, resistanceMode) ?? system;
            var adjusted = actualSystem is not null && exposures.FirstOrDefault()?.SystemLoadKg is { } previousSystem &&
                Math.Abs(previousSystem - actualSystem.Value) < .0001 && bodyWeight?.ReferenceKg is not null;
            var reason = adjusted ? "Bodyweight adjustment: keep the previous system-load target at your current reference bodyweight. " + baseSuggestion.Reason : baseSuggestion.Reason;
            return baseSuggestion with
            {
                SuggestedLoadKg = input,
                SuggestedSystemLoadKg = actualSystem,
                Reason = reason,
                IsBodyweightAdjustment = adjusted,
                ResistanceMode = resistanceMode
            };
        }

        var policyMode = loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly ? ResistanceModes.RepsOnly : resistanceMode;
        return Progression.Suggest(prescription, exposures, mode, new LoadOptions(step, AvailableLoadsKg: availableLoads),
            context.Context?.Revision, policyMode) with { ResistanceMode = resistanceMode };
    }

    private static double? ToInputLoad(double? systemLoad, double? reference, string resistanceMode, double step)
    {
        if (systemLoad is null || reference is null) return null;
        return resistanceMode switch
        {
            ResistanceModes.Added => Progression.RoundToStep(Math.Max(0, systemLoad.Value - reference.Value), step),
            ResistanceModes.Assistance => Progression.RoundToStep(Math.Max(0, reference.Value - systemLoad.Value), step),
            _ => null
        };
    }

    private static double? RecomputeSystemLoad(double? input, double? reference, string resistanceMode)
    {
        if (reference is not { } bodyweight) return null;
        return resistanceMode switch
        {
            ResistanceModes.Bodyweight => bodyweight,
            ResistanceModes.Added when input is { } added => bodyweight + added,
            ResistanceModes.Assistance when input is { } assistance => Math.Max(0, bodyweight - assistance),
            _ => null
        };
    }

}
