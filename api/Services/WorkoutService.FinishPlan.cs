using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public record FinishPlanUpdateInput(string Scope, string ChangesHash, int ProgramRevision, Dictionary<Guid, int> DayRevisions);
public record FinishPlanCounts(int Block, int Program);
public record FinishPlanEditView(string Name, List<string> Changes, int? Occurrences = null);
public record FinishPlanPreview(List<FinishPlanEditView> Edits, FinishPlanCounts Counts, List<string> Changes,
    string ChangesHash, int ProgramRevision, Dictionary<Guid, int> DayRevisions);

public sealed partial class WorkoutService
{
    private sealed record PlanEdit(SessionExercise Exercise, TemplateExercise Home, WorkoutTemplate Day,
        PrescriptionDelta Sets, bool Library, bool Note, bool Rest);
    private sealed record FinishPlan(List<PlanEdit> Edits, List<WorkoutTemplate> Days, List<TemplateExercise> Rows,
        FinishPlanPreview Preview, ProgramLockState Locks);

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
        // Days the run has already passed are history; a finished workout never rewrites them.
        var locks = program is null ? ProgramLockState.Unlocked : await ProgramLockState.Load(db, program.Id, ct);
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
            foreach (var row in Targets(edit, rows, days, "program", locks))
            {
                affectedDays.Add(row.TemplateId);
                if (row.Id == edit.Home.Id) continue;
                total++;
                if (days.Single(d => d.Id == row.TemplateId).Block == edit.Day.Block) block++;
            }
            if (edit.Library) changes.Add("library exercise");
            if (edit.Note) changes.Add("notes");
            if (edit.Rest) changes.Add("rest timer");
            if (edit.Sets.Changed) changes.Add("sets and set types");
        }
        var hash = Fingerprint(edits.Select(e => new { SessionExerciseId = e.Exercise.Id, HomeId = e.Home.Id, e.Exercise.ExerciseId,
            e.Exercise.NameSnapshot, e.Exercise.Note, e.Exercise.RestSeconds, e.Exercise.PrescriptionJson }).ToList());
        var preview = new FinishPlanPreview(edits.Select(e => DescribeEdit(e, e.Library, e.Note, e.Rest,
            e.Sets.Removed.Count, e.Sets.Appended.Count, e.Sets.Patches.Count)).ToList(),
            new(block, total), changes.ToList(), hash, program?.Revision ?? 0,
            days.Where(d => affectedDays.Contains(d.Id)).ToDictionary(d => d.Id, d => d.Revision));
        return new(edits, days, rows, preview, locks);
    }

    private static IEnumerable<TemplateExercise> Targets(PlanEdit edit, List<TemplateExercise> rows,
        List<WorkoutTemplate> days, string scope, ProgramLockState locks)
    {
        var key = ImportValidation.MovementKey(edit.Home.SourceName, edit.Home.Id);
        var allowed = days.Where(d => (scope == "program" || d.Block == edit.Day.Block) && (d.Id == edit.Day.Id || !locks.IsLocked(d)))
            .Select(d => d.Id).ToHashSet();
        return rows.Where(row => allowed.Contains(row.TemplateId) &&
            (row.Id == edit.Home.Id || ImportValidation.MovementKey(row.SourceName, row.Id) == key));
    }

    private async Task<List<FinishPlanEditView>> ApplyFinishPlan(WorkoutSession session, FinishPlanUpdateInput input, CancellationToken ct)
    {
        Validation.Require(input.Scope is "block" or "program", "Choose the same block or whole program.");
        var plan = await ReadFinishPlan(session, ct);
        Validation.Require(plan.Preview.ChangesHash == input.ChangesHash && plan.Preview.ProgramRevision == input.ProgramRevision,
            "The workout or program changed. Review the program update again.", 409);
        Validation.Require(input.DayRevisions is not null && input.DayRevisions.Count == plan.Preview.DayRevisions.Count &&
            plan.Preview.DayRevisions.All(day => input.DayRevisions.TryGetValue(day.Key, out var revision) && revision == day.Value),
            "A program day changed. Review the program update again.", 409);
        var changed = new HashSet<Guid>();
        // Every edit finds its rows before any is rewritten, as the preview counted them: a library
        // edit renames the rows it reaches, which would otherwise change what a later edit matches.
        var reached = plan.Edits.Select(edit => (edit, rows: Targets(edit, plan.Rows, plan.Days, input.Scope, plan.Locks).ToList())).ToList();
        var updates = new List<FinishPlanEditView>();
        foreach (var (edit, rows) in reached)
        {
            var details = new HashSet<string>();
            var occurrences = 0;
            foreach (var row in rows)
            {
                var applied = ApplyPlanEdit(edit, row);
                if (applied.Changes.Count == 0) continue;
                details.UnionWith(applied.Changes);
                occurrences++;
                changed.Add(row.TemplateId);
            }
            if (occurrences > 0) updates.Add(new(edit.Exercise.NameSnapshot, details.ToList(), occurrences));
        }
        foreach (var day in plan.Days.Where(d => changed.Contains(d.Id))) day.Revision++;
        return updates;
    }

    private static FinishPlanEditView ApplyPlanEdit(PlanEdit edit, TemplateExercise row)
    {
        var library = edit.Library && (row.ExerciseId != edit.Exercise.ExerciseId || row.SourceName != edit.Exercise.NameSnapshot
            || row.SubstitutionsJson != edit.Exercise.SubstitutionsJson);
        var note = edit.Note && row.Note != edit.Exercise.Note;
        var rest = edit.Rest && row.RestSeconds != edit.Exercise.RestSeconds;
        if (library)
        {
            row.ExerciseId = edit.Exercise.ExerciseId;
            row.SourceName = edit.Exercise.NameSnapshot;
            row.DemoUrl = ImportDemoLinks.ForName(Json.Read<Dictionary<string, string>>(row.DemoLinksJson), row.SourceName) ?? "";
            row.SubstitutionsJson = edit.Exercise.SubstitutionsJson;
        }
        if (note) row.Note = edit.Exercise.Note;
        if (rest) row.RestSeconds = edit.Exercise.RestSeconds;
        var removed = 0;
        var added = 0;
        var types = 0;
        var prescriptionsChanged = false;
        if (edit.Sets.Changed)
        {
            var before = Json.Read<List<SetPrescription>>(row.SetsJson);
            var after = edit.Sets.Apply(before);
            var applied = PrescriptionDelta.Between(before, after);
            removed = applied.Removed.Count;
            added = applied.Appended.Count;
            types = applied.Patches.Count;
            prescriptionsChanged = !before.SequenceEqual(after);
            if (prescriptionsChanged) row.SetsJson = Json.Write(after);
        }
        var details = DescribeEdit(edit, library, note, rest, removed, added, types);
        if (prescriptionsChanged && removed == 0 && added == 0 && types == 0) details.Changes.Add("Updated the set plan");
        return details;
    }

    private static FinishPlanEditView DescribeEdit(PlanEdit edit, bool library, bool note, bool rest,
        int removed, int added, int types)
    {
        var changes = new List<string>();
        if (library) changes.Add("Changed the linked exercise");
        if (note) changes.Add(string.IsNullOrWhiteSpace(edit.Exercise.Note) ? "Removed exercise notes" : "Updated exercise notes");
        if (rest) changes.Add(edit.Exercise.RestSeconds is { } seconds ? $"Set rest timer to {seconds} sec" : "Reset the rest timer to default");
        if (removed > 0) changes.Add($"Removed {removed} {(removed == 1 ? "set" : "sets")}");
        if (added > 0) changes.Add($"Added {added} {(added == 1 ? "set" : "sets")}");
        if (types > 0) changes.Add($"Changed the type of {types} {(types == 1 ? "set" : "sets")}");
        return new(edit.Exercise.NameSnapshot, changes);
    }
}
