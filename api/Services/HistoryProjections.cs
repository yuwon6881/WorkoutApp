using Workout.Api.Data;

namespace Workout.Api.Services;

/// Finished history keeps start-of-workout snapshots that only an open workout uses: the session's
/// start plan and Nutrition context, each exercise's baseline and progression snapshot, and each
/// set's suggestion. History summaries, the exercise insight, and progress replays never read them,
/// yet selecting them makes PostgreSQL fetch and decompress every out-of-line (TOAST) value. These
/// projections copy every other column, so a caller sees the same values it would from the full row.
/// The rows are untracked read results; never attach or save them.
internal static class HistoryProjections
{
    public static IQueryable<WorkoutSession> WithoutSnapshots(this IQueryable<WorkoutSession> query)
        => query.Select(row => new WorkoutSession
        {
            UserId = row.UserId, Id = row.Id, Revision = row.Revision,
            TemplateId = row.TemplateId, ProgramId = row.ProgramId, ProgramDayProgressId = row.ProgramDayProgressId,
            Name = row.Name, Note = row.Note, Active = row.Active,
            StartedAt = row.StartedAt, FinishedAt = row.FinishedAt, PausedAt = row.PausedAt, PausedSeconds = row.PausedSeconds,
            LastTimingEventAt = row.LastTimingEventAt, BodyWeightSnapshotJson = row.BodyWeightSnapshotJson,
            NutritionContextRevision = row.NutritionContextRevision, RestGeneration = row.RestGeneration, RestStatus = row.RestStatus,
            RestDeadlineUtc = row.RestDeadlineUtc, RestPausedRemainingMs = row.RestPausedRemainingMs,
            RestDurationMs = row.RestDurationMs, RestOriginDeviceId = row.RestOriginDeviceId, GymProfileId = row.GymProfileId
        });

    public static IQueryable<SessionExercise> WithoutSnapshots(this IQueryable<SessionExercise> query)
        => query.Select(row => new SessionExercise
        {
            UserId = row.UserId, Id = row.Id, Revision = row.Revision,
            SessionId = row.SessionId, ExerciseId = row.ExerciseId, NameSnapshot = row.NameSnapshot, Position = row.Position,
            Note = row.Note, PrescriptionJson = row.PrescriptionJson, SequenceGroup = row.SequenceGroup, RestSeconds = row.RestSeconds,
            SubstitutionsJson = row.SubstitutionsJson, LoadModel = row.LoadModel,
            SourceTemplateExerciseId = row.SourceTemplateExerciseId, SourceSlotKey = row.SourceSlotKey, SourcePhaseId = row.SourcePhaseId,
            SwapGroupKey = row.SwapGroupKey, IsReplacement = row.IsReplacement,
            OriginalExerciseId = row.OriginalExerciseId, OriginalNameSnapshot = row.OriginalNameSnapshot,
            SourcePage = row.SourcePage, DemoUrl = row.DemoUrl, DemoLinksJson = row.DemoLinksJson
        });

    public static IQueryable<CompletedSet> WithoutSnapshots(this IQueryable<CompletedSet> query)
        => query.Select(row => new CompletedSet
        {
            UserId = row.UserId, Id = row.Id, Revision = row.Revision,
            SessionExerciseId = row.SessionExerciseId, Position = row.Position,
            WeightKg = row.WeightKg, Reps = row.Reps, DurationSeconds = row.DurationSeconds, Rpe = row.Rpe, Rir = row.Rir,
            Done = row.Done, Warmup = row.Warmup, WorkingSetOrdinal = row.WorkingSetOrdinal,
            ResistanceMode = row.ResistanceMode, SystemLoadKg = row.SystemLoadKg
        });
}
