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
    public string DisplayName { get; set; } = "";
    // Display preferences only. Every stored load is canonical kilograms.
    public string Unit { get; set; } = "kg";
    public string Theme { get; set; } = "dark";
    public int RestSeconds { get; set; } = 90;
    /// Whether the rest timer is allowed to make a sound and raise a notification when it ends.
    public bool RestAlerts { get; set; } = true;
    /// Central Fitness Account subject.
    public string IdentitySubject { get; set; } = "";
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
    /// Explicit loading semantics. An absent/unknown value is treated as external; the app never
    /// infers a bodyweight model from an equipment label.
    public string LoadModel { get; set; } = "external";
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
    /// Lifecycle is derived from completion but persisted so the program list can group it
    /// without replaying all sessions. Existing rows default to standby when migrated.
    public string LifecycleStatus { get; set; } = ProgramLifecycle.Standby;
    public DateTime? CompletedAt { get; set; }
    /// IANA/Windows timezone identifier used for planned dates and phase transitions.
    public string TimeZone { get; set; } = "UTC";
    /// Monday of the first scheduled program week. A null value means this program is not yet
    /// scheduled and can only be activated after the scheduling step is completed.
    public DateOnly? ScheduleAnchor { get; set; }
}

public sealed class ProgramPhase : OwnedRecord
{
    public Guid ProgramId { get; set; }
    public int Position { get; set; }
    public string Name { get; set; } = "";
    public string Block { get; set; } = "";
    public int WeekFrom { get; set; }
    public int WeekTo { get; set; }
    public int DurationWeeks { get; set; }
    public DateOnly? StartDate { get; set; }
    public int? SourcePageFrom { get; set; }
    public int? SourcePageTo { get; set; }
}

public sealed class ProgramSkip : OwnedRecord
{
    public Guid ProgramId { get; set; }
    public Guid TemplateId { get; set; }
    public DateTime SkippedAt { get; set; } = DateTime.UtcNow;
}

public static class ProgramLifecycle
{
    public const string Standby = "standby";
    public const string Active = "active";
    public const string Completed = "completed";
    public static readonly string[] All = [Standby, Active, Completed];
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
    /// ISO weekday (1 = Monday, 7 = Sunday). Null is retained for imported programs awaiting
    /// scheduling and for standalone workouts.
    public int? Weekday { get; set; }
    /// Page in the source document for an imported workout/day heading.
    public int? SourcePage { get; set; }
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
    /// Page in the source document for imported exercise/prescription provenance.
    public int? SourcePage { get; set; }
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
    public DateOnly? PlannedDate { get; set; }
    public string BodyWeightSnapshotJson { get; set; } = "";
    public string NutritionContextJson { get; set; } = "";
    public long? NutritionContextRevision { get; set; }
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
    public string LoadModel { get; set; } = "external";
}

public sealed class CompletedSet : OwnedRecord
{
    public Guid SessionExerciseId { get; set; }
    public int Position { get; set; }
    /// Null is an unknown load and stays unknown. Zero is a genuine bodyweight set.
    public double? WeightKg { get; set; }
    /// Reps and RPE stay null while a set is planned or still being typed; a completed set may
    /// have no actual RPE so that the exposure repeats without advancing progression.
    public int? Reps { get; set; }
    public double? Rpe { get; set; }
    public bool Done { get; set; }
    public bool Warmup { get; set; }
    /// Ordinal among working sets only; warm-ups have no ordinal and never enter progression.
    public int? WorkingSetOrdinal { get; set; }
    /// The exact suggestion presented when the session began. It is deliberately not accepted
    /// from a save request, so later policy/context changes cannot rewrite the user's view.
    public string SuggestionJson { get; set; } = "";
    /// The entered load is external, added, assistance, bodyweight, or intentionally irrelevant.
    public string ResistanceMode { get; set; } = "external";
    /// Frozen effective system load for full-bodyweight records; absent for external, partial
    /// bodyweight, unknown, or reps-only movements.
    public double? SystemLoadKg { get; set; }
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
    public string AlternativesJson { get; set; } = "[]";
    public string SelectedAlternativeId { get; set; } = "";
    public int ChunksDone { get; set; }
    public int ChunksTotal { get; set; }
    public int Calls { get; set; }
    public int UnresolvedCount { get; set; }
    public bool CatalogStale { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public int Retries { get; set; }
    public int VisualFallbacks { get; set; }
    public string PageCoverageJson { get; set; } = "[]";
    public Guid? ProgramId { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    /// A transient private object key. Source bytes are deleted after the import reaches ready,
    /// accepted, failed, or discarded; an unfinished key expires after 24 hours.
    public string SourceFileKey { get; set; } = "";
    public DateTime? SourceFileExpiresAt { get; set; }
}

/// Durable server-side state for a resumable PDF upload. The source key is private and is never
/// returned to the browser; completion turns the uploaded object into the normal import record.
public sealed class ImportUpload : OwnedRecord
{
    public string FileName { get; set; } = "";
    public long ExpectedBytes { get; set; }
    public long ReceivedBytes { get; set; }
    public string SourceFileKey { get; set; } = "";
    public string Status { get; set; } = "open";
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(24);
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

/// Last confirmed Nutrition context. It is a fallback only; a stale row never becomes a zero or
/// silently changes a completed workout's frozen context.
public sealed class NutritionContextCache : OwnedRecord
{
    public string ContextJson { get; set; } = "";
    public DateTime? LastSuccessAt { get; set; }
    public DateTime? LastErrorAt { get; set; }
    public string LastError { get; set; } = "";
}

public sealed class IntegrationGrant : OwnedRecord
{
    public string Peer { get; set; } = "";
    public string Status { get; set; } = "revoked";
    public string ScopesJson { get; set; } = "[]";
    public string EncryptedRefreshToken { get; set; } = "";
    public DateTime? GrantedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}
