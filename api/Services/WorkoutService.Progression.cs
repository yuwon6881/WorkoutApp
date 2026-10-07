using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class WorkoutService
{
    /// A technique never done on this movement before has no history of its own; it starts from the
    /// straight-set load the movement already has rather than from a blank first-time suggestion.
    private SetProgressionSuggestion MakeSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight, IReadOnlyList<double>? availableLoads = null)
    {
        var own = OwnSuggestion(prescription, exposures, mode, step, context, resistanceMode, loadModel, bodyWeight, availableLoads);
        if (SetTechniques.Of(prescription) is null || own.SourceSessionId is not null || own.SourceDate is not null) return own;
        var straight = OwnSuggestion(prescription with { Notes = null }, exposures, mode, step, context, resistanceMode, loadModel,
            bodyWeight, availableLoads);
        return straight.SuggestedLoadKg is null && straight.SuggestedSystemLoadKg is null
            ? own
            : FollowStraightSets(prescription, straight, own);
    }

    private SetProgressionSuggestion OwnSuggestion(SetPrescription prescription, IReadOnlyList<SetExposure> exposures,
        string mode, double step, NutritionContextResult context, string resistanceMode, string loadModel,
        BodyWeightSnapshot? bodyWeight, IReadOnlyList<double>? availableLoads)
    {
        if (loadModel == LoadModels.FullBodyweight)
            return BodyweightProgression.Suggest(prescription, exposures, mode, step, context.Context?.Revision,
                resistanceMode, bodyWeight?.ReferenceKg, availableLoads, DateTime.UtcNow);

        exposures = exposures.Where(exposure => exposure.ResistanceMode == resistanceMode).ToList();
        var policyMode = loadModel is LoadModels.BodyweightContextOnly or LoadModels.RepsOnly ? ResistanceModes.RepsOnly : resistanceMode;
        return Progression.Suggest(prescription, exposures, mode, new LoadOptions(step, AvailableLoadsKg: availableLoads),
            context.Context?.Revision, policyMode,
            policyMode == ResistanceModes.RepsOnly ? _ => null : null, DateTime.UtcNow) with { ResistanceMode = resistanceMode };
    }

    /// A technique set that comes after straight sets in the same exercise (a last-set myo-rep,
    /// partial or drop set) is started with the load those sets just used, so it follows their
    /// progression instead of running its own. Its reps come from the prescription alone: a rep
    /// count inflated by the technique must never read as a reason to add load. Straight sets with
    /// no load to hand on (never done yet) leave the technique set on its own history.
    private static SetProgressionSuggestion FollowStraightSets(SetPrescription prescription,
        SetProgressionSuggestion? straight, SetProgressionSuggestion own)
    {
        if (SetTechniques.Of(prescription) is null || straight is null || straight.ResistanceMode != own.ResistanceMode)
            return own;
        if (straight.SuggestedLoadKg is null && straight.SuggestedSystemLoadKg is null && own.SuggestedLoadKg is not null)
            return own;
        return straight with
        {
            SuggestedReps = prescription.RepMin ?? 0,
            Reason = "Technique set: start with your straight-set load and log the reps you get. It counts toward volume, not strength records or load progression.",
            IsRepRangeTransition = false
        };
    }

}
