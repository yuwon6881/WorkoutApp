using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// A program that writes "Leg Curl" does not say whether the machine is plate-loaded or a weight
/// stack. The library files that plain name under the plate-loaded build, so an import used to link
/// it there even at a gym that only has the stack. The active gym now decides between the two.
public sealed class ImportGenericMachineGymTests
{
    private static string Program(params string[] names)
    {
        var exercises = string.Join(",", names.Select(name =>
            "{\"sourceName\":\"" + name + "\",\"sets\":[{\"repMin\":6,\"repMax\":8,\"targetRpe\":8,\"restSeconds\":90}]}"));
        return "{\"version\":1,\"verified\":true,\"program\":{\"name\":\"Legs\",\"sourceWeekDays\":1,\"days\":["
            + "{\"key\":\"legs\",\"week\":1,\"name\":\"Legs\",\"phaseWeek\":1,\"exercises\":[" + exercises + "]}]}}";
    }

    private static async Task<Harness> Ready(params string[] missing)
    {
        var h = await Harness.Create();
        await h.SignIn();
        await h.Seed(
            new SeedExercise("leg-curl", "Plate-Loaded Leg Curl", "Posterior chain", "Machine", ["Leg Curl"],
                Requires: ["lying-leg-curl.plate|seated-leg-curl.plate"]),
            new SeedExercise("weight-stack-leg-curl", "Weight-Stack Leg Curl", "Posterior chain", "Machine", ["Selectorized Leg Curl"],
                Requires: ["lying-leg-curl.stack|seated-leg-curl.stack"]),
            new SeedExercise("leg-extension", "Plate-Loaded Leg Extension", "Quads", "Machine", ["Leg Extension"],
                Requires: ["leg-extension.plate"]),
            new SeedExercise("weight-stack-leg-extension", "Weight-Stack Leg Extension", "Quads", "Machine", ["Selectorized Leg Extension"],
                Requires: ["leg-extension.stack"]));
        if (missing.Length > 0)
        {
            var gyms = new GymProfileService(h.Db);
            var home = await gyms.Get(default);
            await gyms.Update(home.ActiveId, new("My gym", [.. missing], null, home.Profiles.Single().Revision), default);
        }
        return h;
    }

    private static async Task<List<Guid?>> Linked(Harness h, string json)
    {
        var view = await h.Imports().CreateExternalImport(json, "program.json", default);
        return [.. view.Draft!.Workouts.Single().Exercises.Select(exercise => exercise.ExerciseId)];
    }

    [Fact]
    public async Task A_generic_name_links_to_the_weight_stack_build_when_the_gym_has_no_plate_loaded_machine()
    {
        await using var h = await Ready("leg-extension.plate", "lying-leg-curl.plate", "seated-leg-curl.plate");
        var linked = await Linked(h, Program("LEG CURL", "Leg Extension"));
        Assert.Equal([await h.ExerciseId("weight-stack-leg-curl"), await h.ExerciseId("weight-stack-leg-extension")], linked);
    }

    [Fact]
    public async Task A_generic_name_keeps_the_plate_loaded_build_by_default()
    {
        await using var h = await Ready();
        var linked = await Linked(h, Program("Leg Curl", "Leg Extension"));
        Assert.Equal([await h.ExerciseId("leg-curl"), await h.ExerciseId("leg-extension")], linked);
    }

    [Fact]
    public async Task A_generic_name_keeps_the_plate_loaded_build_when_the_gym_lacks_both_builds()
    {
        await using var h = await Ready("leg-extension.plate", "leg-extension.stack");
        Assert.Equal([await h.ExerciseId("leg-extension")], await Linked(h, Program("Leg Extension")));
    }

    [Fact]
    public async Task A_name_that_states_the_build_is_never_rewritten()
    {
        await using var h = await Ready("leg-extension.plate");
        var linked = await Linked(h, Program("Plate-Loaded Leg Extension", "Weight-Stack Leg Extension"));
        Assert.Equal([await h.ExerciseId("leg-extension"), await h.ExerciseId("weight-stack-leg-extension")], linked);
    }

    [Fact]
    public async Task An_exercise_marked_unavailable_at_the_gym_also_yields_to_the_other_build()
    {
        await using var h = await Ready();
        var gyms = new GymProfileService(h.Db);
        var home = await gyms.Get(default);
        await gyms.Update(home.ActiveId, new("My gym", null,
            new() { [(await h.ExerciseId("leg-extension")).ToString()] = Workout.Api.Data.GymExerciseOverrides.Unavailable },
            home.Profiles.Single().Revision), default);
        Assert.Equal([await h.ExerciseId("weight-stack-leg-extension")], await Linked(h, Program("Leg Extension")));
    }
}
