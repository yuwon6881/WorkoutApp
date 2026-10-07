using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class BodyweightSemanticsTests
{
    [Theory]
    [InlineData(90, 80)]
    [InlineData(70, 80)]
    public async Task Plain_pullups_reestimate_reps_when_Nutrition_weight_changes(double current, double previous)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Pull-Up", LoadModels.FullBodyweight, previous);
        await Complete(h, template, null, 10);
        await Weight(h, current);
        var next = await h.Workouts.Start(template, null, default);
        var set = next.Exercises.Single().Sets.Single();
        Assert.Equal(current, set.SystemLoadKg);
        Assert.Null(set.WeightKg);
        Assert.True(set.Suggestion!.IsBodyweightAdjustment);
        Assert.Equal(current > previous ? 8 : 12, set.Suggestion.SuggestedReps);
    }

    [Theory]
    [InlineData(LoadModels.RepsOnly)]
    [InlineData(LoadModels.BodyweightContextOnly)]
    public async Task Loadless_movements_never_turn_legacy_entered_load_into_strength_or_volume(string model)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Crunch", model, 80);
        var finished = await Complete(h, template, 50, 8);
        var view = await h.Workouts.Get(finished, default);
        var exercise = view.Exercises.Single();
        Assert.Null(exercise.Sets.Single().Estimated1RmKg);
        Assert.Null(view.VolumeKg);
        Assert.Null(view.SystemVolumeKg);
        Assert.Empty(await h.Db.Progress.ToListAsync());
        var insight = await new ExerciseService(h.Db).Insight(exercise.ExerciseId!.Value, "all", 0, 20, default);
        Assert.Null(insight.Estimated1RmKg);
        Assert.Null(insight.HeaviestKg);
        Assert.Equal(8, insight.RepPr);
    }

    [Fact]
    public async Task Missing_current_weight_never_reuses_a_historical_system_load_as_todays_load()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Weighted Pull-Up", LoadModels.FullBodyweight, 80);
        await Complete(h, template, 10, 10);
        var cache = await h.Db.NutritionContexts.SingleAsync();
        cache.ContextJson = Json.Write(Context(null));
        await h.Db.SaveChangesAsync();
        var next = await h.Workouts.Start(template, null, default);
        Assert.Null(next.Exercises.Single().Sets.Single().SystemLoadKg);
        Assert.Null(next.Exercises.Single().Sets.Single().Suggestion!.SuggestedSystemLoadKg);
    }

    [Fact]
    public async Task A_recent_scale_weight_is_used_when_no_trend_or_same_day_weighin_exists()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await Ready(h, "Pull-Up", LoadModels.FullBodyweight, 80);
        var cache = await h.Db.NutritionContexts.SingleAsync();
        cache.ContextJson = Json.Write(Context(80) with { ScaleWeightDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2) });
        await h.Db.SaveChangesAsync();
        var session = await h.Workouts.Start(null, "Training", default);
        Assert.Equal(80, session.BodyWeight!.ReferenceKg);
        Assert.Equal("scale", session.BodyWeight.ReferenceSource);
    }

    [Theory]
    [InlineData("Weighted Pull-Up", 10, 5, 90)]
    [InlineData("Assisted Pull-Up", 20, 25, 60)]
    public async Task Added_load_and_assistance_account_for_the_new_bodyweight(string name, double oldLoad, double input, double system)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, name, LoadModels.FullBodyweight, 80);
        await Complete(h, template, oldLoad, 10);
        await Weight(h, 85);
        var next = await h.Workouts.Start(template, null, default);
        var set = next.Exercises.Single().Sets.Single();
        Assert.Equal(input, set.WeightKg);
        Assert.Equal(system, set.SystemLoadKg);
        Assert.True(set.Suggestion!.IsBodyweightAdjustment);
    }

    [Fact]
    public async Task New_weighins_do_not_rewrite_frozen_history_and_same_reps_at_more_bodyweight_can_earn_strength_only()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Pull-Up", LoadModels.FullBodyweight, 80);
        var first = await Complete(h, template, null, 8);
        await Weight(h, 90);
        var second = await Complete(h, template, null, 8);
        var old = await h.Workouts.Get(first, default);
        Assert.Equal(80, old.BodyWeight!.ReferenceKg);
        Assert.Equal(80, old.Exercises.Single().Sets.Single().SystemLoadKg);
        var latest = await h.Workouts.Get(second, default);
        Assert.Equal("e1rm", latest.Exercises.Single().PrKind);
        Assert.Equal(1, latest.PrCount);
        Assert.Equal(720, latest.SystemVolumeKg);
    }

    [Fact]
    public async Task Missing_frozen_bodyweight_never_makes_entered_added_load_a_strength_record()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Weighted Pull-Up", LoadModels.FullBodyweight, 80);
        var cache = await h.Db.NutritionContexts.SingleAsync();
        cache.ContextJson = Json.Write(Context(null));
        await h.Db.SaveChangesAsync();
        var finished = await Complete(h, template, 50, 8);
        var session = await h.Workouts.Get(finished, default);
        Assert.Null(session.Exercises.Single().Sets.Single().Estimated1RmKg);
        Assert.Null(session.SystemVolumeKg);
        Assert.Empty(await h.Db.Progress.ToListAsync());
    }

    [Theory]
    [InlineData(-8, true)]
    [InlineData(1, true)]
    [InlineData(0, false)]
    public async Task Stale_future_or_unconfirmed_weight_stays_unknown(int offset, bool confirmed)
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Pull-Up", LoadModels.FullBodyweight, 80);
        var cache = await h.Db.NutritionContexts.SingleAsync();
        cache.ContextJson = Json.Write(Context(80) with { ScaleWeightDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(offset), Confirmed = confirmed });
        await h.Db.SaveChangesAsync();
        var session = await h.Workouts.Start(template, null, default);
        Assert.Null(session.BodyWeight);
        Assert.Null(session.Exercises.Single().Sets.Single().SystemLoadKg);
    }

    private static NutritionTrainingContext Context(double? weight) => new(null, 1, "UTC", "maintain", false,
        null, null, null, weight, DateOnly.FromDateTime(DateTime.UtcNow), null, null, DateTime.UtcNow, true);

    [Fact]
    public async Task Loadless_rep_records_do_not_depend_on_Nutrition_weight()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Crunch", LoadModels.RepsOnly, 80);
        await Complete(h, template, null, 8);
        await Weight(h, 90);
        var finished = await Complete(h, template, null, 9);
        var session = await h.Workouts.Get(finished, default);
        Assert.Equal("reps", session.Exercises.Single().PrKind);
        Assert.Null(session.SystemVolumeKg);
        Assert.Null(session.Exercises.Single().Sets.Single().Estimated1RmKg);
    }

    [Fact]
    public async Task Insights_keep_a_finished_workouts_load_model_after_catalog_reclassification()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Pull-Up", LoadModels.FullBodyweight, 80);
        var finished = await Complete(h, template, null, 8);
        var session = await h.Workouts.Get(finished, default);
        var id = session.Exercises.Single().ExerciseId!.Value;
        var before = await new ExerciseService(h.Db).Insight(id, "all", 0, 20, default);
        await h.Seed(new SeedExercise("movement", "Pull-Up", "Back", "Bodyweight", null, 2.5, LoadModels.RepsOnly));
        var after = await new ExerciseService(h.Db).Insight(id, "all", 0, 20, default);
        Assert.Equal(before.Estimated1RmKg, after.Estimated1RmKg);
        Assert.Equal(before.LargestSessionVolumeKg, after.LargestSessionVolumeKg);
        Assert.Equal(LoadModels.RepsOnly, (await h.Workouts.Start(template, null, default)).Exercises.Single().LoadModel);
    }

    private static async Task Weight(Harness h, double weight)
    {
        var cache = await h.Db.NutritionContexts.SingleAsync();
        cache.ContextJson = Json.Write(Context(weight));
        cache.LastSuccessAt = DateTime.UtcNow;
        await h.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task Correcting_an_assisted_catalog_model_does_not_compare_total_resistance_with_old_assistance_entries()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var template = await Ready(h, "Assisted Pull-Up", LoadModels.External, 80);
        await Complete(h, template, 20, 8);
        await h.Seed(new SeedExercise("movement", "Assisted Pull-Up", "Back", "Machine", null, 2.5, LoadModels.FullBodyweight));
        var next = await h.Workouts.Start(template, null, default);
        Assert.Null(next.Exercises.Single().PreviousBestE1rmKg);
        await h.Workouts.Discard(next.Id, default);
        var firstComparable = await Complete(h, template, 20, 8);
        Assert.False((await h.Workouts.Get(firstComparable, default)).Exercises.Single().IsPr);
    }

    private static async Task<Guid> Ready(Harness h, string name, string model, double weight)
    {
        h.Db.IntegrationGrants.Add(new IntegrationGrant { UserId = h.Db.CurrentUser!.Value, Peer = "nutrition",
            Status = "active", CentralConnectionId = Guid.NewGuid(), CentralConnectionGeneration = 1 });
        h.Db.NutritionContexts.Add(new NutritionContextCache { UserId = h.Db.CurrentUser.Value,
            ContextJson = Json.Write(Context(weight)), LastSuccessAt = DateTime.UtcNow });
        await h.Db.SaveChangesAsync();
        await h.Seed(new SeedExercise("movement", name, "Back", "Bodyweight", null, 2.5, model));
        var id = await h.ExerciseId("movement");
        return (await h.Templates.Create(Harness.Template("Training", Harness.Exercise(id, name,
            Harness.Set(8, 12, 8))), null, 1, 0, default)).Id;
    }

    private static async Task<Guid> Complete(Harness h, Guid template, double? load, int reps)
    {
        var session = await h.Workouts.Start(template, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null, [new SessionExerciseInput(exercise.ExerciseId,
            exercise.Name, null, exercise.Prescription, [new SetInput(load, reps, 8, true)])], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
        return session.Id;
    }
}
