namespace Workout.Api.Data;

public sealed partial class TrainingProgram
{
    /// Some programs preserve source prescriptions with no stated effort target.
    public bool AllowUnspecifiedEffort { get; set; }
}
