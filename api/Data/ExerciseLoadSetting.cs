namespace Workout.Api.Data;

// Id is the stable catalog or custom exercise id. Defaults stay seed-owned. At most one of the
// step, the weight list and the stack is set; none of them restores the inherited rule.
public sealed class ExerciseLoadSetting : OwnedRecord
{
    public double? LoadStepKg { get; set; }
    public string? AvailableLoadsJson { get; set; }
    /// A LoadStack of the same user. Not a database key: a deleted stack is cleared by the service,
    /// and resolution falls through if one is ever missing.
    public Guid? StackId { get; set; }
}

/// The account's rule for one equipment group, such as every cable exercise.
public sealed class EquipmentLoadDefault : OwnedRecord
{
    /// An EquipmentGroups key, unique per user.
    public string Equipment { get; set; } = "";
    public double? LoadStepKg { get; set; }
    public string? AvailableLoadsJson { get; set; }
    public Guid? StackId { get; set; }
}

/// A named set of available weights, or a fixed step, that several exercises can share, such as
/// one gym's cable stack. Exactly one of the step and the list is set.
public sealed class LoadStack : OwnedRecord
{
    public string Name { get; set; } = "";
    public double? LoadStepKg { get; set; }
    public string? AvailableLoadsJson { get; set; }
}
