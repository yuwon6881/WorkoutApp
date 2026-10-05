using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record FinishPlanUpdateInput(string Scope, string ChangesHash, int ProgramRevision, Dictionary<Guid, int> DayRevisions);
public record FinishPlanCounts(int Block, int Program);
public record FinishPlanEditView(string Name);
public record FinishPlanPreview(List<FinishPlanEditView> Edits, FinishPlanCounts Counts, List<string> Changes,
    string ChangesHash, int ProgramRevision, Dictionary<Guid, int> DayRevisions);

public sealed partial class WorkoutService
{
    private sealed record PlanEdit(SessionExercise Exercise, TemplateExercise Home, WorkoutTemplate Day,
        PrescriptionDelta Sets, bool Library, bool Note, bool Rest);
    private sealed record FinishPlan(List<PlanEdit> Edits, List<WorkoutTemplate> Days, List<TemplateExercise> Rows,
        FinishPlanPreview Preview);

    public async Task<FinishPlanPreview> PreviewFinishPlan(Guid id, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var session = await db.Workouts.SingleOrDefaultAsync(w => w.Id == id, ct);
        Validation.Require(session is { Active: true }, "This workout is no longer active.", 409);
        var plan = await ReadFinishPlan(session!, ct);
        await gate.Commit(ct);
        return plan.Preview;
    }

    private async Task<FinishPlan> ReadFinishPlan(WorkoutSession session, CancellationToken ct)
    {
        var program = session.ProgramId is { } id ? await db.Programs.SingleOrDefaultAsync(p => p.Id == id, ct) : null;
        var days = program is null ? [] : await db.Templates.Where(t => t.ProgramId == program.Id && !t.IsRestDay).ToListAsync(ct);
        var dayIds = days.Select(d => d.Id).ToList();
        var rows = await db.TemplateExercises.Where(e => dayIds.Contains(e.TemplateId)).ToListAsync(ct);
        var exercises = await db.SessionExercises.Where(e => e.SessionId == session.Id).OrderBy(e => e.Position).ToListAsync(ct);
        var edits = new List<PlanEdit>();
        foreach (var exercise in exercises.Where(e => e.SourceTemplateExerciseId is not null && e.BaselineJson.Length > 0))
        {
            var home = rows.SingleOrDefault(e => e.Id == exercise.SourceTemplateExerciseId);
            if (home is null) continue;
            var baseline = Json.Read<SessionExerciseBaseline>(exercise.BaselineJson);
            var sets = PrescriptionDelta.Between(Json.Read<List<SetPrescription>>(baseline.PrescriptionJson),
                Json.Read<List<SetPrescription>>(exercise.PrescriptionJson));
            var library = baseline.ExerciseId != exercise.ExerciseId;
            var note = baseline.Note != exercise.Note;
            var rest = baseline.RestSeconds != exercise.RestSeconds;
            if (library || note || rest || sets.Changed)
                edits.Add(new(exercise, home, days.Single(d => d.Id == home.TemplateId), sets, library, note, rest));
        }
        var block = 0;
        var total = 0;
        var affectedDays = new HashSet<Guid>();
        var changes = new HashSet<string>();
        foreach (var edit in edits)
        {
            foreach (var row in Targets(edit, rows, days, "program"))
            {
                affectedDays.Add(row.TemplateId);
                if (row.Id == edit.Home.Id) continue;
                total++;
                if (days.Single(d => d.Id == row.TemplateId).Block == edit.Day.Block) block++;
            }
            if (edit.Library) changes.Add("library exercise");
            if (edit.Note) changes.Add("notes");
            if (edit.Rest) changes.Add("rest timer");
            if (edit.Sets.Changed) changes.Add("sets and reps");
        }
        var hash = Fingerprint(edits.Select(e => new { SessionExerciseId = e.Exercise.Id, HomeId = e.Home.Id, e.Exercise.ExerciseId,
            e.Exercise.NameSnapshot, e.Exercise.Note, e.Exercise.RestSeconds, e.Exercise.PrescriptionJson }).ToList());
        var preview = new FinishPlanPreview(edits.Select(e => new FinishPlanEditView(e.Exercise.NameSnapshot)).ToList(),
            new(block, total), changes.ToList(), hash, program?.Revision ?? 0,
            days.Where(d => affectedDays.Contains(d.Id)).ToDictionary(d => d.Id, d => d.Revision));
        return new(edits, days, rows, preview);
    }

    private static IEnumerable<TemplateExercise> Targets(PlanEdit edit, List<TemplateExercise> rows,
        List<WorkoutTemplate> days, string scope)
    {
        var key = ImportValidation.MovementKey(edit.Home.SourceName);
        var allowed = days.Where(d => scope == "program" || d.Block == edit.Day.Block).Select(d => d.Id).ToHashSet();
        return rows.Where(row => allowed.Contains(row.TemplateId) &&
            (row.Id == edit.Home.Id || ImportValidation.MovementKey(row.SourceName) == key));
    }

    private async Task ApplyFinishPlan(WorkoutSession session, FinishPlanUpdateInput input, CancellationToken ct)
    {
        Validation.Require(input.Scope is "block" or "program", "Choose the same block or whole program.");
        var plan = await ReadFinishPlan(session, ct);
        Validation.Require(plan.Preview.ChangesHash == input.ChangesHash && plan.Preview.ProgramRevision == input.ProgramRevision,
            "The workout or program changed. Review the program update again.", 409);
        Validation.Require(input.DayRevisions is not null && input.DayRevisions.Count == plan.Preview.DayRevisions.Count &&
            plan.Preview.DayRevisions.All(day => input.DayRevisions.TryGetValue(day.Key, out var revision) && revision == day.Value),
            "A program day changed. Review the program update again.", 409);
        var changed = new HashSet<Guid>();
        foreach (var edit in plan.Edits)
        foreach (var row in Targets(edit, plan.Rows, plan.Days, input.Scope))
        {
            if (edit.Library)
            {
                row.ExerciseId = edit.Exercise.ExerciseId;
                row.SourceName = edit.Exercise.NameSnapshot;
                row.DemoUrl = ImportDemoLinks.ForName(Json.Read<Dictionary<string, string>>(row.DemoLinksJson), row.SourceName) ?? "";
                row.SubstitutionsJson = edit.Exercise.SubstitutionsJson;
            }
            if (edit.Note) row.Note = edit.Exercise.Note;
            if (edit.Rest) row.RestSeconds = edit.Exercise.RestSeconds;
            if (edit.Sets.Changed) row.SetsJson = Json.Write(edit.Sets.Apply(Json.Read<List<SetPrescription>>(row.SetsJson)));
            changed.Add(row.TemplateId);
        }
        foreach (var day in plan.Days.Where(d => changed.Contains(d.Id))) day.Revision++;
    }
}
