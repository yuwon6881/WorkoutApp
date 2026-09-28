namespace Workout.Api.Data;

// Generations describe committed source changes, including deletions and edits to old rows.
public sealed class ResourceGeneration
{
    public Guid UserId { get; set; }
    public long Programs { get; set; }
    public long Templates { get; set; }
    public long Sessions { get; set; }
    public long Imports { get; set; }
    public long Progress { get; set; }
    public long CustomExercises { get; set; }
    public long ExerciseLoads { get; set; }
    public long Preferences { get; set; }
    public long History { get; set; }
    public Guid? HistoryAppendId { get; set; }
}

// Derived data is disposable: source generations and calculator versions gate every read.
public sealed class TrainingReadModel
{
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "";
    public Guid SourceId { get; set; }
    public long Generation { get; set; }
    public int Version { get; set; }
    public string Json { get; set; } = "";
}
