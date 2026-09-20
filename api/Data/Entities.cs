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
    /// JSON array of normalized secondary muscle groups. The primary muscle remains in Muscle.
    public string SecondaryMusclesJson { get; set; } = "[]";
    public string Equipment { get; set; } = "";
    public string Cue { get; set; } = "";
    public bool Active { get; set; } = true;
    /// The smallest load change this exercise can actually make in a gym. Zero means the load
    /// is not adjustable at all, so progression happens through reps.
    public double LoadStepKg { get; set; } = 2.5;
    /// Explicit loading semantics. An absent/unknown value is treated as external; the app never
    /// infers a bodyweight model from an equipment label.
    public string LoadModel { get; set; } = "external";
    /// Curated movement pattern used to rank safe substitution candidates. It is optional for
    /// legacy catalog rows; an empty value simply falls back to muscle/equipment matching.
    public string MovementPattern { get; set; } = "";
}

/// Account-owned exercises extend the shared seed catalog without allowing one user to mutate
/// or remove another user's library. Archived rows remain resolvable by historical workouts.
public sealed class CustomExercise : OwnedRecord
{
    public string Name { get; set; } = "";
    public string Muscle { get; set; } = "";
    /// JSON array of normalized secondary muscle groups. The primary muscle remains in Muscle.
    public string SecondaryMusclesJson { get; set; } = "[]";
    public string Equipment { get; set; } = "";
    public string Cue { get; set; } = "";
    public double LoadStepKg { get; set; } = 2.5;
    public string LoadModel { get; set; } = "external";
    public string MovementPattern { get; set; } = "";
    public bool Archived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ArchivedAt { get; set; }
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
    public int Weeks { get; set; } = 1;
    public bool Active { get; set; }
    public Guid? SourceImportId { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    /// Lifecycle is derived from completion but persisted so the program list can group it
    /// without replaying all sessions. Existing rows default to standby when migrated.
    public string LifecycleStatus { get; set; } = ProgramLifecycle.Standby;
    public DateTime? CompletedAt { get; set; }
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
    /// Page in the source document for an imported workout/day heading.
    public int? SourcePage { get; set; }
    /// Stable phase identity. The display name is not unique (two phases may both be called
    /// "Base"), so substitutions always use this id when a program phase is available.
    public Guid? ProgramPhaseId { get; set; }
    /// Immutable snapshot of the template and its exercise slots when first saved or imported.
    public string BaselineJson { get; set; } = "";
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
    /// Stable identity for this logical exercise slot. Editing a template updates this row in
    /// place so active sessions and future substitutions keep their source link.
    public Guid SlotKey { get; set; } = Guid.NewGuid();
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
    public Guid? SourceTemplateExerciseId { get; set; }
    public Guid? SourceSlotKey { get; set; }
    public Guid? SourcePhaseId { get; set; }
    /// Rows created by a partial swap share a group key. The original row retains completed sets
    /// while the replacement row contains the continuation sets.
    public Guid? SwapGroupKey { get; set; }
    public bool IsReplacement { get; set; }
    public Guid? OriginalExerciseId { get; set; }
    public string OriginalNameSnapshot { get; set; } = "";
    public int? SourcePage { get; set; }
    /// Snapshot of the planned exercise and its initial sets when the workout begins.
    public string BaselineJson { get; set; } = "";
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

/// Durable account-scoped record of an in-session substitution. A pending row is applied to the
/// remaining slots in the same phase only when the user opts into retention at finish.
public sealed class ExerciseSubstitution : OwnedRecord
{
    public Guid SessionId { get; set; }
    public Guid? SourceTemplateExerciseId { get; set; }
    public Guid? SourceSlotKey { get; set; }
    public Guid? SourcePhaseId { get; set; }
    public Guid? OriginalExerciseId { get; set; }
    public string OriginalName { get; set; } = "";
    public Guid? ReplacementExerciseId { get; set; }
    public string ReplacementName { get; set; } = "";
    public string Scope { get; set; } = "slot";
    public bool PendingRetention { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RetainedAt { get; set; }
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

/// Audit marker for a user-requested exercise-history clear. The marker is intentionally small;
/// it lets exports and support tooling explain why a finished session has no sets for the slot.
public sealed class ExerciseHistoryClear : OwnedRecord
{
    public Guid ExerciseId { get; set; }
    public string NameSnapshot { get; set; } = "";
    public DateTime ClearedAt { get; set; } = DateTime.UtcNow;
    public int RemovedSets { get; set; }
    public int AffectedWorkouts { get; set; }
}

public sealed class AiImport : OwnedRecord
{
    public string Status { get; set; } = ImportStatus.Pending;
    public string DocumentHash { get; set; } = "";
    public string PromptVersion { get; set; } = "";
    public string FileName { get; set; } = "";
    public int Pages { get; set; }
    public string DraftJson { get; set; } = "";
    /// Immutable copy of the normalized draft when extraction reaches Ready.
    public string DraftBaselineJson { get; set; } = "";
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
    // Legacy persisted state retained for database compatibility; review mappings use the
    // searchable picker now.
    public bool CatalogStale { get; set; }
    public long InputTokens { get; set; }
    public long CachedInputTokens { get; set; }
    public long OutputTokens { get; set; }
    public int Retries { get; set; }
    /// Durable execution lease used to fence duplicate workers across instances. A stale worker
    /// may finish a provider call, but it cannot commit after another lease has taken ownership.
    public string LeaseId { get; set; } = "";
    public DateTime? LeaseUntil { get; set; }
    /// Successful section responses survive a later section failure so a retry
    /// never pays for work that the provider already completed.
    public string ChunkResultsJson { get; set; } = "";
    public string PageCoverageJson { get; set; } = "[]";
    /// Reconciliation notes recorded while reading, such as a section whose day count differed
    /// from the outline's estimate. They are shown in review rather than failing the import.
    public string NoticesJson { get; set; } = "[]";
    public Guid? ProgramId { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    /// The page text the browser extracted from the PDF. The document itself never reaches this
    /// server, so this is the entire source: it is cleared once the import reaches ready,
    /// accepted, failed, or discarded, and an unfinished import expires after 24 hours.
    public string SourceTextJson { get; set; } = "";
    public DateTime? SourceExpiresAt { get; set; }
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
