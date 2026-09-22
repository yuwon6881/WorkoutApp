using Microsoft.EntityFrameworkCore;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// The formula and the policy are pure, so they are tested without a database. The session
/// tests below then prove the rules actually reach a started workout.
public class ProgressionFormulaTests
{
    [Fact] public void An_estimate_rates_the_set_as_if_it_had_been_carried_to_failure()
    {
        // 60 kg for 3 at RPE 8 means 2 reps were left, so the load is rated as a set of 5.
        Assert.Equal(60 * (1 + 5 / 30.0), Progression.E1rm(60, 3, 8)!.Value, 6);
        // The same load and reps taken to failure is a stronger showing, so a higher estimate.
        Assert.True(Progression.E1rm(60, 3, 10) < Progression.E1rm(60, 5, 10));
    }

    [Fact] public void A_set_that_cannot_support_an_estimate_returns_nothing_rather_than_a_number()
    {
        Assert.Null(Progression.E1rm(null, 5, 8));
        Assert.Null(Progression.E1rm(60, null, 8));
        Assert.Null(Progression.E1rm(60, 5, null));
        // Too easy to say anything, and too many reps for the equation to hold.
        Assert.Null(Progression.E1rm(60, 5, 5));
        Assert.Null(Progression.E1rm(60, 20, 9));
    }

    [Fact] public void Estimate1Rm_supports_optional_effort_rating()
    {
        // With RPE
        Assert.Equal(60 * (1 + 5 / 30.0), Progression.Estimate1Rm(60, 3, 8)!.Value, 6);
        Assert.Equal(100 * (1 + 1 / 30.0), Progression.Estimate1Rm(100, 1, 10)!.Value, 6);
        // Without RPE (reps at face value)
        Assert.Equal(60 * (1 + 5 / 30.0), Progression.Estimate1Rm(60, 5)!.Value, 6);
        Assert.Equal(60 * (1 + 5 / 30.0), Progression.Estimate1Rm(60, 5, null)!.Value, 6);
        // Invalid boundaries
        Assert.Null(Progression.Estimate1Rm(null, 5));
        Assert.Null(Progression.Estimate1Rm(60, null));
        Assert.Null(Progression.Estimate1Rm(60, 0));
        Assert.Null(Progression.Estimate1Rm(60, 20));
        Assert.Null(Progression.Estimate1Rm(60, 5, 5));
    }

    private static ProgressionPlan Plan(int repMin, int repMax, double? rpe, params PreviousSet[] previous)
        => Progression.Next(repMin, repMax, rpe, previous.ToList(), null, 2.5);

    [Fact] public void Reps_climb_through_the_range_before_the_load_moves()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(60, 3, 7));
        Assert.Equal(0, plan.DeltaKg);
        Assert.Equal(4, plan.TargetReps);
    }

    [Fact] public void Finishing_the_range_adds_load_and_resets_the_reps()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(60, 5, 8));
        Assert.Equal(2.5, plan.DeltaKg);
        Assert.Equal(3, plan.TargetReps);
        Assert.Equal(62.5, plan.SuggestedTopKg);
    }

    [Fact] public void Finishing_the_range_never_adds_more_than_one_equipment_step()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(60, 5, 6.5));
        Assert.Equal(2.5, plan.DeltaKg);
        Assert.Equal(3, plan.TargetReps);
    }

    [Fact] public void A_set_harder_than_the_target_repeats_instead_of_progressing()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(60, 4, 9.5));
        Assert.Equal(0, plan.DeltaKg);
        Assert.Equal(3, plan.TargetReps);
        Assert.Contains("Repeat", plan.Reason);
    }

    [Fact] public void Missing_the_bottom_of_the_range_holds_the_load()
    {
        var plan = Plan(5, 8, 8, new PreviousSet(60, 3, 9));
        Assert.Equal(0, plan.DeltaKg);
        Assert.Equal(5, plan.TargetReps);
    }

    [Fact] public void Three_consecutive_hard_exposures_deload_from_the_last_successful_load()
    {
        var exposures = new[]
        {
            new SetExposure(Guid.NewGuid(), DateTime.UtcNow, 60, 3, 9.5),
            new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-7), 60, 3, 9.5),
            new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-14), 60, 3, 9.5),
            new SetExposure(Guid.NewGuid(), DateTime.UtcNow.AddDays(-21), 60, 5, 8)
        };
        var suggestion = Progression.SuggestSet(5, 8, 8, exposures, ProgressionModes.Normal, 2.5);
        Assert.Equal(55, suggestion.SuggestedLoadKg);
        Assert.Contains("Deload", suggestion.Reason);
    }

    [Fact] public void The_heaviest_honest_estimate_of_the_session_is_the_one_that_counts()
    {
        // The strongest showing wins, not the last set logged or the heaviest bar.
        Assert.Equal(Progression.E1rm(60, 8, 9)!.Value, Progression.SessionE1rm([new PreviousSet(60, 8, 9), new PreviousSet(65, 2, 7)])!.Value, 6);
        Assert.Null(Progression.SessionE1rm([new PreviousSet(60, 30, 9), new PreviousSet(null, 5, 8)]));
    }

    [Fact] public void An_exercise_with_no_adjustable_load_progresses_by_reps_only()
    {
        var plan = Progression.Next(8, 12, 8, [new PreviousSet(0, 12, 7)], null, 0);
        Assert.Equal(0, plan.DeltaKg);
        Assert.Equal(12, plan.TargetReps);
    }

    [Fact] public void Without_an_effort_rating_the_load_repeats_rather_than_being_guessed_at()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(60, 5, null));
        Assert.Equal(0, plan.DeltaKg);
        Assert.Contains("No actual RPE", plan.Reason);
    }

    [Fact] public void A_first_session_suggests_nothing_at_all()
    {
        var plan = Plan(3, 5, 8, new PreviousSet(null, null, null));
        Assert.Null(plan.SuggestedTopKg);
        Assert.Equal(3, plan.TargetReps);
    }

    [Fact] public void The_trend_moves_toward_a_new_session_without_chasing_it()
    {
        var first = Progression.Advance(null, 100);
        Assert.Equal(100, first.TrendE1rmKg);
        var second = Progression.Advance(first, 120);
        Assert.Equal(106, second.TrendE1rmKg, 6);
        Assert.Equal(0, second.Stalls);
        var third = Progression.Advance(second, 90);
        Assert.Equal(1, third.Stalls);
    }

    [Fact] public void Loads_land_on_what_the_equipment_can_actually_make()
    {
        Assert.Equal(62.5, Progression.RoundToStep(61.8, 2.5));
        Assert.Equal(61.8, Progression.RoundToStep(61.8, 0));
        Assert.Equal(0, Progression.StepForEquipment("Bodyweight"));
        Assert.Equal(2, Progression.StepForEquipment("Dumbbell"));
        Assert.Equal(2.5, Progression.StepForEquipment(""));
    }
}

public class ProgressionSessionTests
{
    private static async Task<(Harness h, Guid templateId)> Ready(int repMin = 3, int repMax = 5)
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("bench", "Bench press", "Chest", "Barbell", "Cue", null));
        var benchId = await h.ExerciseId("bench");
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(benchId, "Bench press", Harness.Set(repMin, repMax), Harness.Set(repMin, repMax))), null, 1, 0, default);
        return (h, template.Id);
    }

    private static async Task Log(Harness h, SessionView session, double weight, int reps, double rpe)
    {
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null, [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
            exercise.Sets.Select(_ => new SetInput(weight, reps, rpe, true)).ToList())], session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    [Fact] public async Task A_session_left_with_reps_in_the_tank_comes_back_asking_for_one_more_rep()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await Log(h, await h.Workouts.Start(templateId, null, default), 60, 3, 7);

        var next = await h.Workouts.Start(templateId, null, default);
        var sets = next.Exercises.Single().Sets;
        Assert.Equal(60, sets[0].WeightKg);
        Assert.Equal(4, sets[0].Reps);
        Assert.All(sets, s => Assert.False(s.Done));
        Assert.All(sets, s => Assert.Null(s.Rpe));
    }

    [Fact] public async Task Topping_the_rep_range_comes_back_heavier_with_the_reps_reset()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await Log(h, await h.Workouts.Start(templateId, null, default), 60, 5, 8);

        var next = await h.Workouts.Start(templateId, null, default);
        var sets = next.Exercises.Single().Sets;
        Assert.Equal(62.5, sets[0].WeightKg);
        Assert.Equal(3, sets[0].Reps);
    }

    [Fact] public async Task The_suggestion_explains_itself_and_survives_a_save()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        await Log(h, await h.Workouts.Start(templateId, null, default), 60, 5, 8);

        var next = await h.Workouts.Start(templateId, null, default);
        var exercise = next.Exercises.Single();
        Assert.NotNull(exercise.Progression);
        Assert.Equal(62.5, exercise.Progression!.SuggestedKg);
        Assert.Contains("Increase one equipment step", exercise.Progression.Reason);
        Assert.Equal(2.5, exercise.Progression.StepKg);

        var saved = await h.Workouts.Save(next.Id, new SessionInput("note", [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
            exercise.Sets.Select(s => new SetInput(s.WeightKg, s.Reps, s.Rpe, false)).ToList())], next.Revision, null), default);
        Assert.Contains("Increase one equipment step", saved.Exercises.Single().Progression!.Reason);
    }

    [Fact] public async Task A_load_the_user_never_recorded_stays_unknown_instead_of_becoming_zero()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var first = await h.Workouts.Start(templateId, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null, [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
            [new SetInput(null, 5, 8, true), new SetInput(null, 5, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var next = await h.Workouts.Start(templateId, null, default);
        Assert.All(next.Exercises.Single().Sets, s => Assert.Null(s.WeightKg));
        Assert.Null(next.Exercises.Single().Progression!.SuggestedKg);
    }

    [Fact] public async Task Only_completed_working_sets_feed_the_running_estimate()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var first = await h.Workouts.Start(templateId, null, default);
        var exercise = first.Exercises.Single();
        // A heavy warm-up and an abandoned heavy set must not look like strength.
        await h.Workouts.Save(first.Id, new SessionInput(null, [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
            [new SetInput(200, 5, 10, true, Warmup: true), new SetInput(60, 5, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var stored = await h.Db.Progress.AsNoTracking().SingleAsync();
        Assert.Equal(Progression.E1rm(60, 5, 8)!.Value, stored.TrendE1rmKg, 6);
    }

    [Fact] public async Task Back_off_sets_keep_their_spacing_when_the_load_moves()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var first = await h.Workouts.Start(templateId, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null, [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
            [new SetInput(60, 5, 8, true), new SetInput(50, 5, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var sets = (await h.Workouts.Start(templateId, null, default)).Exercises.Single().Sets;
        Assert.Equal(62.5, sets[0].WeightKg);
        Assert.Equal(52.5, sets[1].WeightKg);
    }

    [Fact] public async Task A_skipped_first_set_keeps_the_second_set_ordinal()
    {
        var (h, templateId) = await Ready();
        await using var _h = h;
        var first = await h.Workouts.Start(templateId, null, default);
        var exercise = first.Exercises.Single();
        await h.Workouts.Save(first.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(null, null, null, false), new SetInput(60, 5, 8, true)])], first.Revision, null), default);
        await h.Workouts.Finish(first.Id, null, default);

        var next = (await h.Workouts.Start(templateId, null, default)).Exercises.Single().Sets;
        Assert.Null(next[0].WeightKg);
        Assert.Equal(62.5, next[1].WeightKg);
    }

    [Fact] public async Task Training_summary_includes_an_active_session_as_in_progress()
    {
        var h = await Harness.Create();
        await using var _h = h;
        await h.SignIn();

        await h.Workouts.Start(null, "In progress", default);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var summary = await h.Workouts.TrainingSummary(today, today, null, default);

        var item = Assert.Single(summary);
        Assert.Equal("in_progress", item.Status);
        Assert.False(item.Completed);
        Assert.StartsWith("session:", item.Id);
    }

    [Fact] public async Task Added_bodyweight_load_is_rounded_and_system_load_uses_the_same_value()
    {
        var h = await Harness.Create();
        await using var _h = h;
        await h.SignIn();
        await h.Seed(new SeedExercise("pull-up", "Pull-up", "Back", "Bodyweight", "Pull", null, 2.5, LoadModels.FullBodyweight));
        var exerciseId = await h.ExerciseId("pull-up");
        var template = await h.Templates.Create(
            Harness.Template("Pull", Harness.Exercise(exerciseId, "Pull-up", Harness.Set(3, 8))), null, 1, 0, default);
        var session = await h.Workouts.Start(template.Id, null, default);
        var row = await h.Db.Workouts.SingleAsync(item => item.Id == session.Id);
        row.BodyWeightSnapshotJson = Json.Write(new BodyWeightSnapshot(80, null, null, null, 80, "scale", null, "test", null, DateTime.UtcNow));
        await h.Db.SaveChangesAsync();

        var exercise = session.Exercises.Single();
        var saved = await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(exercise.ExerciseId, exercise.Name, null, exercise.Prescription,
                [new SetInput(3, 5, 8, true, ResistanceMode: ResistanceModes.Added, Id: exercise.Sets[0].Id)])], session.Revision, null), default);

        var set = Assert.Single(saved.Exercises.Single().Sets);
        Assert.Equal(2.5, set.WeightKg);
        Assert.Equal(82.5, set.SystemLoadKg);
    }

    [Fact] public async Task An_exercise_outside_the_catalog_still_progresses_by_its_name()
    {
        var h = await Harness.Create();
        await using var _h = h;
        await h.SignIn();
        var template = await h.Templates.Create(
            Harness.Template("Push", Harness.Exercise(null, "Reverse Nordic Curl", Harness.Set(3, 5))), null, 1, 0, default);
        await Log(h, await h.Workouts.Start(template.Id, null, default), 20, 5, 8);

        var sets = (await h.Workouts.Start(template.Id, null, default)).Exercises.Single().Sets;
        Assert.Equal(22.5, sets[0].WeightKg);
        var stored = await h.Db.Progress.AsNoTracking().SingleAsync();
        Assert.Equal(Guid.Empty, stored.ExerciseId);
        Assert.Equal("reverse nordic curl", stored.NameKey);
    }
}
