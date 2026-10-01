using Workout.Api.Domain;

namespace Workout.Api.Data;

// Id is the stable catalog or custom exercise id. Neither value means inherit the default.
public sealed class ExerciseLoadSetting : OwnedRecord
{
    public double? LoadStepKg { get; set; }
    /// The unit the step was typed in. Reads in the other unit map it to that unit's nearest step.
    public string LoadStepUnit { get; set; } = WeightUnits.Kg;
    public string? AvailableLoadsJson { get; set; }
}

/// The account's rule for one equipment group, such as every cable exercise.
public sealed class EquipmentLoadDefault : OwnedRecord
{
    /// An EquipmentGroups key, unique per user.
    public string Equipment { get; set; } = "";
    public double? LoadStepKg { get; set; }
    public string LoadStepUnit { get; set; } = WeightUnits.Kg;
    public string? AvailableLoadsJson { get; set; }
}
