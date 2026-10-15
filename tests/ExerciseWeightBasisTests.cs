using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExerciseWeightBasisTests
{
    [Fact]
    public async Task Migration_backfills_every_audited_catalog_row_from_legacy_defaults()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "deploy", "exercises.json"))) root = root.Parent;
        var input = Json.Read<List<SeedExercise>>(File.ReadAllText(Path.Combine(root!.FullName, "deploy", "exercises.json")));
        await using var h = await Harness.Create();
        await h.Seed(input.Select(row => row with { WeightBasis = WeightBases.Total }).ToArray());
        foreach (var operation in new Workout.Api.Data.Migrations.ExerciseWeightBasis().UpOperations.OfType<SqlOperation>())
            await h.Db.Database.ExecuteSqlRawAsync(operation.Sql);
        h.Db.ChangeTracker.Clear();
        var rows = await h.Db.Exercises.AsNoTracking().ToDictionaryAsync(row => row.Slug);
        Assert.All(input, expected => Assert.Equal(expected.WeightBasis, rows[expected.Slug].WeightBasis));
    }

    [Fact]
    public void Every_shipped_exercise_has_an_explicit_audited_basis()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "deploy", "exercises.json"))) root = root.Parent;
        Assert.NotNull(root);
        using var source = JsonDocument.Parse(File.ReadAllText(Path.Combine(root!.FullName, "deploy", "exercises.json")));
        var rows = source.RootElement.EnumerateArray().ToList();
        Assert.All(rows, row => Assert.True(WeightBases.IsValid(row.GetProperty("weightBasis").GetString()!)));
        var bySlug = rows.ToDictionary(row => row.GetProperty("slug").GetString()!);
        foreach (var slug in new[] { "db-lateral-raise", "db-bench-press", "single-arm-db-row", "db-romanian-deadlift", "cable-flye" })
            Assert.Equal(WeightBases.PerSide, bySlug[slug].GetProperty("weightBasis").GetString());
        foreach (var slug in new[] { "goblet-squat", "db-pullover", "overhead-db-triceps-extension", "single-leg-db-hip-thrust", "db-french-press" })
            Assert.Equal(WeightBases.Total, bySlug[slug].GetProperty("weightBasis").GetString());
        Assert.All(rows.Where(row => row.GetProperty("equipment").GetString() == "Machine"),
            row => Assert.Equal(WeightBases.Total, row.GetProperty("weightBasis").GetString()));
    }

    [Fact]
    public async Task Custom_basis_is_validated_persisted_and_account_scoped()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var service = new ExerciseService(h.Db);
        await Assert.ThrowsAsync<DomainException>(() => service.Create(new("Bad", "Chest", "Dumbbell", WeightBasis: "guess"), default));
        await Assert.ThrowsAsync<DomainException>(() => service.Create(new("Bad bodyweight", "Chest", "Bodyweight",
            LoadModel: LoadModels.FullBodyweight, WeightBasis: WeightBases.PerSide), default));
        var side = await service.Create(new("My dumbbell press", "Chest", "Dumbbell", WeightBasis: WeightBases.PerSide), default);
        var total = await service.Create(new("My machine press", "Chest", "Machine"), default);
        Assert.Equal(WeightBases.PerSide, side.WeightBasis);
        Assert.Equal(WeightBases.Total, total.WeightBasis);
        Assert.Equal(WeightBases.PerSide, (await h.Catalog.All(default)).Single(x => x.Id == side.Id).WeightBasis);
        await service.ArchiveCustom(side.Id, default);
        Assert.Equal(WeightBases.PerSide, (await ExerciseWeightBasis.Read(h.Db, [side.Id], default))[side.Id]);
        await h.SignIn("other");
        Assert.Empty(await ExerciseWeightBasis.Read(h.Db, [side.Id], default));
    }

    [Fact]
    public async Task Start_swap_restore_and_history_use_identity_basis_without_rescaling_loads()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new("db-bench", "DB bench", "Chest", "Dumbbell", null, WeightBasis: WeightBases.PerSide),
            new("machine-bench", "Machine bench", "Chest", "Machine", null));
        var side = await h.ExerciseId("db-bench");
        var total = await h.ExerciseId("machine-bench");
        var template = await h.Templates.Create(Harness.Template("Push", Harness.Exercise(side, "DB bench", Harness.Set(8, 10))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        Assert.Equal(WeightBases.PerSide, session.Exercises.Single().WeightBasis);
        session = await h.Workouts.Swap(session.Id,
            new(session.Exercises.Single().Id, total, "Machine bench", session.Revision, null), default);
        Assert.Equal(WeightBases.Total, session.Exercises.Single().WeightBasis);
        session = await h.Workouts.RestoreExercise(session.Id, new(session.Exercises.Single().Id, session.Revision), default);
        Assert.Equal(WeightBases.PerSide, session.Exercises.Single().WeightBasis);
        session = await h.Workouts.Save(session.Id, new(null,
            [new(side, "DB bench", null, [Harness.Set(8, 10)], [new(20, 10, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        var history = await h.Workouts.Get(session.Id, default);
        Assert.Equal(WeightBases.PerSide, history.Exercises.Single().WeightBasis);
        Assert.Equal(20, history.Exercises.Single().Sets.Single().WeightKg);
        Assert.Equal(200, history.VolumeKg);
    }

    [Fact]
    public async Task Reseeding_keeps_legacy_identities_on_the_canonical_basis()
    {
        await using var h = await Harness.Create();
        await h.Seed(new SeedExercise("db-rdl", "DB RDL", "Hamstrings", "Dumbbell", null));
        var legacyId = await h.ExerciseId("db-rdl");
        var input = new SeedExercise("db-romanian-deadlift", "DB Romanian Deadlift", "Hamstrings", "Dumbbell", null, WeightBasis: WeightBases.PerSide);
        await h.Seed(input);
        await h.Seed(input);
        Assert.Equal(WeightBases.PerSide, (await ExerciseWeightBasis.Read(h.Db, [legacyId], default))[legacyId]);
        Assert.Single(await h.Catalog.All(default));
    }
}
