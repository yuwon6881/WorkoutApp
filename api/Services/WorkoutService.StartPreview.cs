using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// One planned set's load as Start would pre-fill it. `Position` is the set's index in the plan.
public sealed record StartPreviewSet(int Position, bool Warmup, double? WeightKg, string ResistanceMode);

public sealed record StartPreviewExercise(Guid TemplateExerciseId, List<StartPreviewSet> Sets);

public sealed partial class WorkoutService
{
    /// The loads Start would pre-fill for a workout plan, so the preview can show them before anything
    /// exists. It runs the same planning as Start and then discards it: nothing is saved, no lock is
    /// taken, and a later Start recomputes from whatever history exists by then.
    public async Task<List<StartPreviewExercise>> StartPreview(Guid templateId, CancellationToken ct)
    {
        var contextResult = await nutrition.Get(ct);
        var template = await db.Templates.AsNoTracking().SingleOrDefaultAsync(t => t.Id == templateId, ct);
        Validation.Require(template != null, "That workout plan no longer exists.", 404);
        if (template!.IsRestDay) return [];
        var session = new WorkoutSession { UserId = db.CurrentUser!.Value, TemplateId = template.Id, Name = template.Name };
        try
        {
            await PlanSessionSets(session, template, contextResult, ChooseBodyWeight(contextResult.Context), ct);
            var sets = db.Sets.Local.ToLookup(set => set.SessionExerciseId);
            return db.SessionExercises.Local.Where(row => row.SessionId == session.Id && row.SourceTemplateExerciseId is not null)
                .OrderBy(row => row.Position)
                .Select(row => new StartPreviewExercise(row.SourceTemplateExerciseId!.Value, sets[row.Id].OrderBy(set => set.Position)
                    .Select(set => new StartPreviewSet(set.Position, set.Warmup, set.WeightKg, set.ResistanceMode)).ToList()))
                .ToList();
        }
        finally { db.ChangeTracker.Clear(); }
    }
}
