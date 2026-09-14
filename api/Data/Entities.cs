namespace Workout.Api.Data;

public abstract class OwnedRecord
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Revision { get; set; }
}

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = "";
    public int Slot { get; set; }
    public string PasswordHash { get; set; } = "";
    // Display preferences only. Every stored load is canonical kilograms.
    public string Unit { get; set; } = "kg";
    public string Theme { get; set; } = "dark";
    public int RestSeconds { get; set; } = 90;
    /// Whether the rest timer is allowed to make a sound and raise a notification when it ends.
    public bool RestAlerts { get; set; } = true;
}

public sealed class AuthSession
{
    public string Hash { get; set; } = "";
    public Guid UserId { get; set; }
    public DateTime Expires { get; set; }
}

/// Catalog rows are global and read-only to users; only the seed command writes them.
public sealed class Exercise
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Muscle { get; set; } = "";
    public string Equipment { get; set; } = "";
    public string Cue { get; set; } = "";
    public bool Active { get; set; } = true;
    /// The smallest load change this exercise can actually make in a gym. Zero means the load
    /// is not adjustable at all, so progression happens through reps.
    public double LoadStepKg { get; set; } = 2.5;
}

public sealed class ExerciseAlias
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ExerciseId { get; set; }
    public string Normalized { get; set; } = "";
    public string Alias { get; set; } = "";
}

public sealed class TrainingProgram : OwnedRecord
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int Weeks { get; set; } = 1;
    public bool Active { get; set; }
    public Guid? SourceImportId { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
}

/// A standalone template has no ProgramId. A program workout carries its week and position,
/// so every (week, position) pair is its own progression slot.
public sealed class WorkoutTemplate : OwnedRecord
{
    public Guid? ProgramId { get; set; }
    public string Name { get; set; } = "";
    public string Focus { get; set; } = "";
    public string Note { get; set; } = "";
    public int Week { get; set; } = 1;
    public int Position { get; set; }
    public string Block { get; set; } = "";
    public string Phase { get; set; } = "";
    public int PhaseWeek { get; set; } = 1;
    public bool IsRestDay { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
}

public sealed class TemplateExercise : OwnedRecord
{
    public Guid TemplateId { get; set; }
    public Guid? ExerciseId { get; set; }
    public string SourceName { get; set; } = "";
    public int Position { get; set; }
    public string Note { get; set; } = "";
    public string SetsJson { get; set; } = "[]";
    public string SequenceGroup { get; set; } = "";
    public string SubstitutionsJson { get; set; } = "[]";
}

public sealed class WorkoutSession : OwnedRecord
{
    public Guid? TemplateId { get; set; }
    public Guid? ProgramId { get; set; }
    public string Name { get; set; } = "";
    public string Note { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
}

/// Names and prescriptions are snapshotted so a later catalog edit cannot rewrite history.
public sealed class SessionExercise : OwnedRecord
{
    public Guid SessionId { get; set; }
    public Guid? ExerciseId { get; set; }
    public string NameSnapshot { get; set; } = "";
    public int Position { get; set; }
    public string Note { get; set; } = "";
    public string PrescriptionJson { get; set; } = "[]";
    /// The suggestion this exercise started with, snapshotted so the reason the user read when
    /// the workout began survives every later save. It is server-derived and never accepted
    /// from the client.
    public string ProgressionJson { get; set; } = "";
    public string SequenceGroup { get; set; } = "";
    public string SubstitutionsJson { get; set; } = "[]";
}

public sealed class CompletedSet : OwnedRecord
{
    public Guid SessionExerciseId { get; set; }
    public int Position { get; set; }
    /// Null is an unknown load and stays unknown. Zero is a genuine bodyweight set.
    public double? WeightKg { get; set; }
    /// Reps and RPE stay null while a set is planned or still being typed; completing it requires both.
    public int? Reps { get; set; }
    public double? Rpe { get; set; }
    public bool Done { get; set; }
    public bool Warmup { get; set; }
}

/// The running strength estimate for one exercise, derived from completed sets. It is a cache
/// that lets a workout start without replaying history: losing a row costs a suggestion, never
/// a record. ExerciseId is Guid.Empty for an exercise that never matched the catalog, and
/// NameKey then carries its normalised name so unmatched work still progresses.
public sealed class ExerciseProgress : OwnedRecord
{
    public Guid ExerciseId { get; set; }
    public string NameKey { get; set; } = "";
    public double TrendE1rmKg { get; set; }
    public double LastE1rmKg { get; set; }
    public int Stalls { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class AiImport : OwnedRecord
{
    public string Status { get; set; } = ImportStatus.Pending;
    public string DocumentHash { get; set; } = "";
    public string PromptVersion { get; set; } = "";
    public string FileName { get; set; } = "";
    public int Pages { get; set; }
    public string DraftJson { get; set; } = "";
    public string Error { get; set; } = "";
    public string Model { get; set; } = "";
    public string Stage { get; set; } = "done";
    public string OutlineJson { get; set; } = "";
    public int ChunksDone { get; set; }
    public int ChunksTotal { get; set; }
    public int Calls { get; set; }
    public int UnresolvedCount { get; set; }
    public bool CatalogStale { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public Guid? ProgramId { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
}

public static class ImportStatus
{
    public const string Pending = "pending";
    public const string Ready = "ready";
    public const string Failed = "failed";
    public const string Accepted = "accepted";
    public const string Discarded = "discarded";
    public static readonly string[] All = [Pending, Ready, Failed, Accepted, Discarded];
}

public sealed class AiUsage
{
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public int Count { get; set; }
}

public sealed class MutationReceipt
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
}
