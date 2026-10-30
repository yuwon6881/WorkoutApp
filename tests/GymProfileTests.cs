using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class GymProfileTests
{
    private static GymProfileService Gyms(Harness h) => new(h.Db);

    private static async Task<Guid> DayFor(Harness h, Guid id)
        => (await h.Templates.Create(Harness.Template("Day", Harness.Exercise(id, "Lift", Harness.Set(10, 15))), null, 1, 0, default)).Id;

    private static async Task LogAndFinish(Harness h, Guid templateId, Guid id, double kg)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        var exercise = session.Exercises.Single();
        await h.Workouts.Save(session.Id, new SessionInput(null,
            [new SessionExerciseInput(id, "Lift", null, exercise.Prescription,
                [new SetInput(kg, 15, 8, true, Id: exercise.Sets[0].Id)], Id: exercise.Id)],
            session.Revision, null), default);
        await h.Workouts.Finish(session.Id, null, default);
    }

    private static async Task<double?> StartingLoad(Harness h, Guid templateId)
    {
        var session = await h.Workouts.Start(templateId, null, default);
        await h.Workouts.Discard(session.Id, default);
        return session.Exercises.Single().Sets[0].WeightKg;
    }

    [Fact]
    public async Task An_account_gets_a_first_gym_that_new_workouts_record()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("curl", "Barbell Curl", "Biceps", "Barbell", null, Requires: ["barbell"]));

        var view = await Gyms(h).Get(default);

        var gym = Assert.Single(view.Profiles);
        Assert.Equal((GymProfileService.DefaultName, true, gym.Id), (gym.Name, gym.Active, view.ActiveId));
        var session = await h.Workouts.Start(null, "Arms", default);
        Assert.Equal(gym.Id, (await h.Db.Workouts.AsNoTracking().SingleAsync(x => x.Id == session.Id)).GymProfileId);
        Assert.Equal(["barbell"], (await h.Catalog.All(default)).Single().Requires);
    }

    [Fact]
    public async Task Weight_rules_belong_to_the_gym_they_were_set_at()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("pushdown", "Pushdown", "Triceps", "Cable", null));
        var id = await h.ExerciseId("pushdown");
        var loads = new LoadSettingsService(h.Db, h.Catalog);
        var home = (await Gyms(h).Get(default)).ActiveId;
        await loads.SaveEquipment(EquipmentGroups.Cable, new(5, null, 0), default);
        await new ExerciseLoadSettingsService(h.Db).Save(id, new(1.25, null, 0), default);

        var hotel = (await Gyms(h).Create(new("Hotel"), default)).Profiles.Single(x => x.Name == "Hotel").Id;
        await Gyms(h).Activate(hotel, default);

        Assert.Equal(LoadSources.App, (await loads.Get(default)).Equipment.Single(x => x.Group == EquipmentGroups.Cable).Source);
        Assert.False((await new ExerciseLoadSettingsService(h.Db).Get(id, default)).IsCustomized);

        await Gyms(h).Activate(home, default);
        Assert.Equal(1.25, (await h.Catalog.All(default)).Single().LoadStepKg);
    }

    [Fact]
    public async Task A_copied_gym_starts_with_the_source_gym_settings()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var home = await Gyms(h).Get(default);
        await Gyms(h).Update(home.ActiveId, new("Home", ["hack-squat"], null, 1), default);
        await new LoadSettingsService(h.Db, h.Catalog).SaveEquipment(EquipmentGroups.Dumbbell, new(1, null, 0), default);

        var view = await Gyms(h).Create(new("Garage", home.ActiveId), default);
        await Gyms(h).Activate(view.Profiles.Single(x => x.Name == "Garage").Id, default);

        Assert.Equal(["hack-squat"], view.Profiles.Single(x => x.Name == "Garage").MissingEquipment);
        var dumbbell = (await new LoadSettingsService(h.Db, h.Catalog).Get(default)).Equipment.Single(x => x.Group == EquipmentGroups.Dumbbell);
        Assert.Equal((1.0, LoadSources.Equipment), (dumbbell.StepKg, dumbbell.Source));
    }

    [Fact]
    public async Task Edits_are_validated_and_revision_checked()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var gym = (await Gyms(h).Get(default)).ActiveId;
        await Gyms(h).Create(new("Hotel"), default);

        await Rejected(400, "That equipment is not on the list.", () => Gyms(h).Update(gym, new("Home", ["jetpack"], null, 1), default));
        await Rejected(400, "You already have a gym with that name.", () => Gyms(h).Update(gym, new("hotel", [], null, 1), default));
        await Rejected(400, null, () => Gyms(h).Create(new(""), default));
        await Rejected(400, "That exercise choice is not valid.", () =>
            Gyms(h).Update(gym, new("Home", [], new() { ["not-an-id"] = GymExerciseOverrides.Unavailable }, 1), default));
        await Rejected(404, "That gym no longer exists.", () => Gyms(h).Update(Guid.NewGuid(), new("Home", [], null, 1), default));

        var exerciseId = Guid.NewGuid().ToString();
        var saved = await Gyms(h).Update(gym, new("Home", ["leg-press.plate"], new() { [exerciseId] = GymExerciseOverrides.Unavailable }, 1), default);
        Assert.Equal(GymExerciseOverrides.Unavailable, saved.Profiles.Single(x => x.Id == gym).ExerciseOverrides[exerciseId]);

        var stale = await Assert.ThrowsAsync<DomainException>(() => Gyms(h).Update(gym, new("Home", [], null, 1), default));
        Assert.Equal(409, stale.Status);
    }

    private static async Task Rejected(int status, string? message, Func<Task> action)
    {
        var failure = await Assert.ThrowsAsync<DomainException>(action);
        Assert.Equal(status, failure.Status);
        if (message is not null) Assert.Equal(message, failure.Message);
    }

    [Fact]
    public async Task Names_and_the_number_of_gyms_are_bounded()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await Gyms(h).Get(default);

        var longest = new string('g', GymProfileLimits.NameLength);
        Assert.Contains((await Gyms(h).Create(new(longest), default)).Profiles, x => x.Name == longest);
        await Rejected(400, null, () => Gyms(h).Create(new(longest + "g"), default));
        Assert.Equal("Home gym", (await Gyms(h).Create(new("  Home   gym "), default)).Profiles.Last().Name);

        for (var count = 3; count < GymProfileLimits.MaxProfiles; count++) await Gyms(h).Create(new($"Gym {count}"), default);
        Assert.Equal(GymProfileLimits.MaxProfiles, (await Gyms(h).Get(default)).Profiles.Count);
        await Rejected(400, $"You can keep up to {GymProfileLimits.MaxProfiles} gyms.", () => Gyms(h).Create(new("One more"), default));
    }

    [Fact]
    public async Task One_account_cannot_see_or_change_another_accounts_gyms()
    {
        await using var h = await Harness.Create();
        await h.SignIn("alice");
        var alice = await Gyms(h).Create(new("Hotel"), default);
        var aliceHotel = alice.Profiles.Single(x => x.Name == "Hotel");

        await h.SignIn("bob");
        var bob = await Gyms(h).Get(default);
        Assert.Equal(GymProfileService.DefaultName, Assert.Single(bob.Profiles).Name);
        Assert.Contains((await Gyms(h).Create(new("Hotel"), default)).Profiles, x => x.Name == "Hotel");

        await Rejected(404, null, () => Gyms(h).Update(aliceHotel.Id, new("Taken", [], null, aliceHotel.Revision), default));
        await Rejected(404, null, () => Gyms(h).Activate(aliceHotel.Id, default));
        await Rejected(404, null, () => Gyms(h).Delete(aliceHotel.Id, default));
        await Rejected(404, null, () => Gyms(h).Create(new("Copy", aliceHotel.Id), default));
        Assert.Equal(2, (await h.Db.GymProfiles.IgnoreQueryFilters().CountAsync(x => x.Name == "Hotel")));
        Assert.Equal("Hotel", (await h.Db.GymProfiles.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == aliceHotel.Id)).Name);
    }

    [Fact]
    public async Task Switching_gyms_waits_for_the_open_workout_and_the_active_gym_cannot_be_deleted()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var home = (await Gyms(h).Get(default)).ActiveId;
        var hotel = (await Gyms(h).Create(new("Hotel"), default)).Profiles.Single(x => x.Name == "Hotel").Id;
        var session = await h.Workouts.Start(null, "Push", default);

        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Gyms(h).Activate(hotel, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Gyms(h).Delete(home, default))).Status);

        await h.Workouts.Discard(session.Id, default);
        Assert.Equal(hotel, (await Gyms(h).Activate(hotel, default)).ActiveId);
    }

    [Fact]
    public async Task Deleting_a_gym_removes_its_weights_and_unlinks_its_workouts()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        var home = (await Gyms(h).Get(default)).ActiveId;
        await new LoadSettingsService(h.Db, h.Catalog).SaveEquipment(EquipmentGroups.Cable, new(5, null, 0), default);
        await h.Seed(new SeedExercise("curl", "Barbell Curl", "Biceps", "Barbell", null));
        var curl = await h.ExerciseId("curl");
        await LogAndFinish(h, await DayFor(h, curl), curl, 30);
        var finished = await h.Db.Workouts.AsNoTracking().SingleAsync();
        var hotel = (await Gyms(h).Create(new("Hotel"), default)).Profiles.Single(x => x.Name == "Hotel").Id;
        await Gyms(h).Activate(hotel, default);

        var view = await Gyms(h).Delete(home, default);

        Assert.Equal(hotel, Assert.Single(view.Profiles).Id);
        Assert.False(await h.Db.EquipmentLoadDefaults.AnyAsync());
        Assert.Null((await h.Db.Workouts.AsNoTracking().SingleAsync(x => x.Id == finished.Id)).GymProfileId);
    }

    [Fact]
    public async Task Machine_progression_reads_only_the_same_gym_while_free_weights_share_history()
    {
        await using var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(new SeedExercise("leg-press", "Weight-Stack Leg Press", "Quads", "Machine", null),
            new SeedExercise("curl", "Barbell Curl", "Biceps", "Barbell", null));
        var press = await h.ExerciseId("leg-press");
        var curl = await h.ExerciseId("curl");
        var pressDay = await DayFor(h, press);
        var curlDay = await DayFor(h, curl);
        var home = (await Gyms(h).Get(default)).ActiveId;
        await LogAndFinish(h, pressDay, press, 100);
        await LogAndFinish(h, curlDay, curl, 30);
        var homePress = await StartingLoad(h, pressDay);
        var homeCurl = await StartingLoad(h, curlDay);
        Assert.NotNull(homePress);

        var hotel = (await Gyms(h).Create(new("Hotel"), default)).Profiles.Single(x => x.Name == "Hotel").Id;
        await Gyms(h).Activate(hotel, default);

        Assert.Null(await StartingLoad(h, pressDay));
        Assert.Equal(homeCurl, await StartingLoad(h, curlDay));

        await Gyms(h).Activate(home, default);
        Assert.Equal(homePress, await StartingLoad(h, pressDay));
    }

    [Fact]
    public void Every_catalog_requirement_names_listed_equipment()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "deploy", "exercises.json")))
            directory = directory.Parent;
        var rows = Json.Read<List<SeedExercise>>(File.ReadAllText(Path.Combine(directory!.FullName, "deploy", "exercises.json")));

        Assert.Empty(rows.Where(row => !(row.Requires ?? []).All(GymEquipment.IsValidRequirement)).Select(row => row.Name));
        Assert.All(rows.Where(row => row.Equipment is "Machine" or "Cable" or "Smith Machine" && row.Name != "Donkey Calf Raise"),
            row => Assert.NotEmpty(row.Requires ?? []));
    }
}
