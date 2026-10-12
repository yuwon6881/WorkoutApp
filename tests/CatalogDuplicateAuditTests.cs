using Microsoft.EntityFrameworkCore;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class CatalogDuplicateAuditTests
{
    [Fact]
    public void Shipped_names_do_not_repeat_the_same_equipment_and_word_order_independent_movement()
    {
        var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "deploy", "exercises.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var rows = Json.Read<List<SeedExercise>>(File.ReadAllText(Path.Combine(directory.FullName, "deploy", "exercises.json")));
        var duplicates = rows.GroupBy(row => (CatalogMatching.WordSetKey(CatalogService.Normalize(row.Name)),
                row.Equipment, row.LoadModel, Tracking: row.TrackingMode ?? "reps"))
            .Where(group => group.Key.Item1.Length > 0 && group.Count() > 1)
            .Select(group => string.Join(", ", group.Select(row => row.Slug)));
        Assert.Empty(duplicates);
    }

    [Fact]
    public async Task Consolidating_a_synonym_keeps_saved_ids_settings_history_and_progression_usable()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("barbell-bench-press", "Barbell Bench Press", "Chest", "Barbell", null),
            new SeedExercise("bench-press", "Bench Press", "Chest", "Barbell", null));
        var legacyId = await h.ExerciseId("barbell-bench-press");
        var canonicalId = await h.ExerciseId("bench-press");
        var template = await h.Templates.Create(Harness.Template("Bench", Harness.Exercise(legacyId,
            "Barbell Bench Press", Harness.Set(8, 12, 8))), null, 1, 0, default);
        var first = await h.Workouts.Start(template.Id, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(legacyId, exercise.Name, null, exercise.Prescription,
                [new SetInput(50, 10, 8, true, Id: exercise.Sets.Single().Id)], Id: exercise.Id)], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);
        h.Db.ExerciseLoadSettings.Add(new Workout.Api.Data.ExerciseLoadSetting
            { Id = legacyId, UserId = h.Db.CurrentUser!.Value, LoadStepKg = 1 });
        await h.Db.SaveChangesAsync();

        for (var pass = 0; pass < 2; pass++)
            await h.Seed(new SeedExercise("bench-press", "Bench Press", "Chest", "Barbell", ["Barbell Bench Press"]));
        var visible = Assert.Single(await h.Catalog.All(default));
        Assert.Equal(canonicalId, visible.Id);
        Assert.Equal(canonicalId, await h.Catalog.Match("Barbell Bench Press", default));
        Assert.Equal(legacyId, (await h.Templates.Get(template.Id, default)).Exercises.Single().ExerciseId);
        await h.Catalog.RequireAllActive([legacyId], default);
        Assert.Equal(1, (await h.Progression.LoadInfo([legacyId], default))[legacyId].StepKg);
        Assert.Equal(legacyId, (await h.Workouts.Get(first.Id, default)).Exercises.Single().ExerciseId);
        var next = (await h.Workouts.Start(template.Id, null, default)).Exercises.Single().Sets.Single();
        Assert.Equal(50, next.WeightKg);
        Assert.Equal(11, next.Reps);
        Assert.Equal(first.Id, next.Suggestion!.SourceSessionId);
        Assert.Equal(2, await h.Db.Exercises.CountAsync());
    }

    [Fact]
    public async Task A_legacy_row_remains_visible_when_its_loading_semantics_differ_or_canonical_is_absent()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("barbell-bench-press", "Barbell Bench Press", "Chest", "Barbell", null));
        Assert.Single(await h.Catalog.All(default));
        await h.Seed(new SeedExercise("bench-press", "Bench Press", "Chest", "Dumbbell", null));
        Assert.Equal(2, (await h.Catalog.All(default)).Count);
    }
}
