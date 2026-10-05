using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed record SessionStartExercise(Guid Id, int Position, Guid? SourceTemplateExerciseId,
    Guid? SourceSlotKey, Guid? SourcePhaseId, string DemoLinksJson, string BaselineJson);

internal static class SessionStartPlan
{
    public static SessionStartExercise Capture(SessionExercise row) => new(row.Id, row.Position,
        row.SourceTemplateExerciseId, row.SourceSlotKey, row.SourcePhaseId, row.DemoLinksJson, row.BaselineJson);

    public static List<SessionStartExercise> Read(WorkoutSession session, IEnumerable<SessionExercise> remaining)
        => string.IsNullOrEmpty(session.StartPlanJson)
            ? remaining.Where(row => !string.IsNullOrEmpty(row.BaselineJson)).Select(Capture).ToList()
            : Json.Read<List<SessionStartExercise>>(session.StartPlanJson);

    public static SessionExercise Restore(AppDb db, WorkoutSession session, SessionStartExercise saved)
    {
        var baseline = Json.Read<SessionExerciseBaseline>(saved.BaselineJson);
        var row = new SessionExercise
        {
            Id = saved.Id, UserId = session.UserId, SessionId = session.Id, Position = saved.Position,
            ExerciseId = baseline.ExerciseId, NameSnapshot = baseline.NameSnapshot, Note = baseline.Note,
            PrescriptionJson = baseline.PrescriptionJson, SequenceGroup = baseline.SequenceGroup,
            SubstitutionsJson = baseline.SubstitutionsJson, LoadModel = baseline.LoadModel,
            ProgressionJson = baseline.ProgressionJson, RestSeconds = baseline.RestSeconds,
            SourcePage = baseline.SourcePage, DemoUrl = baseline.DemoUrl ?? "", DemoLinksJson = saved.DemoLinksJson,
            SourceTemplateExerciseId = saved.SourceTemplateExerciseId, SourceSlotKey = saved.SourceSlotKey,
            SourcePhaseId = saved.SourcePhaseId, BaselineJson = saved.BaselineJson
        };
        db.SessionExercises.Add(row);
        foreach (var set in baseline.PlannedSets)
            db.Sets.Add(new CompletedSet
            {
                UserId = session.UserId, SessionExerciseId = row.Id, Position = set.Position,
                WorkingSetOrdinal = set.WorkingSetOrdinal, Warmup = set.Warmup, WeightKg = set.WeightKg,
                Reps = set.Reps, Rpe = set.Rpe, SuggestionJson = set.SuggestionJson,
                ResistanceMode = set.ResistanceMode, SystemLoadKg = set.SystemLoadKg
            });
        return row;
    }
}
