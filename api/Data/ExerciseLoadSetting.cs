namespace Workout.Api.Data;

// Id is the stable catalog or custom exercise id. Defaults stay seed-owned.
public sealed class ExerciseLoadSetting : OwnedRecord
{
    public double? LoadStepKg { get; set; }
    public string? AvailableLoadsJson { get; set; }
}
