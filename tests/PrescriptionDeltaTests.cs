using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

/// Finishing a program workout offers to carry its plan changes forward. Putting a set back to how
/// it was (a type switched and switched back, a note cleared) is not a change worth asking about.
public sealed class PrescriptionDeltaTests
{
    private static SetPrescription Set(string? notes = null, string rpeSource = "extracted", int reps = 8)
        => new(reps, 10, null, 90, null, null, notes, Rir: "2", RpeSource: rpeSource);

    [Fact]
    public void A_changed_provenance_label_alone_is_not_a_plan_change()
        => Assert.False(PrescriptionDelta.Between([Set()], [Set(rpeSource: "userEdited")]).Changed);

    [Fact]
    public void An_empty_note_and_no_note_are_the_same()
        => Assert.False(PrescriptionDelta.Between([Set(notes: "")], [Set(notes: null)]).Changed);

    [Fact]
    public void A_real_change_is_still_a_change()
    {
        Assert.True(PrescriptionDelta.Between([Set()], [Set(notes: "Myo-reps")]).Changed);
        Assert.True(PrescriptionDelta.Between([Set()], [Set() with { Warmup = true }]).Changed);
        Assert.True(PrescriptionDelta.Between([Set()], [Set(), Set()]).Changed);
        Assert.True(PrescriptionDelta.Between([Set(), Set()], [Set()]).Changed);
    }

    [Fact]
    public void Reps_load_and_effort_targets_are_never_a_plan_change()
    {
        Assert.False(PrescriptionDelta.Between([Set()], [Set(reps: 6)]).Changed);
        Assert.False(PrescriptionDelta.Between([Set()], [Set() with { RepMax = 12, TargetRpe = 9, Rir = "0", LoadText = "80 kg" }]).Changed);
    }

    [Fact]
    public void A_changed_set_type_carries_with_the_effort_it_writes_but_not_provenance()
    {
        var delta = PrescriptionDelta.Between([Set(), Set()], [Set(notes: "Myo-reps", rpeSource: "userEdited"), Set()]);

        var patched = delta.Apply([Set(reps: 6), Set(reps: 6)]);

        Assert.Equal("extracted", patched[0].RpeSource);
        Assert.Equal("Myo-reps", patched[0].Notes);
        Assert.Equal(6, patched[0].RepMin);
    }

    [Fact]
    public void A_type_change_carries_only_what_the_type_writes_not_other_targets_that_also_differ()
    {
        // The finished session changed this set into myo-reps and also ran it at other reps, rest and load.
        var edited = Set(notes: "Myo-reps", reps: 12) with { RepMax = 15, TargetRpe = 7, Rir = "3", RestSeconds = 30, LoadText = "40 kg" };
        var delta = PrescriptionDelta.Between([Set()], [edited]);
        Assert.True(delta.Changed);

        // Another week prints its own targets for the set; only the technique reaches it.
        var other = Set(reps: 5) with { RepMax = 6, TargetRpe = 9, Rir = "1", RestSeconds = 180, LoadText = "100 kg" };
        var patched = delta.Apply([other])[0];

        Assert.Equal("Myo-reps", patched.Notes);
        Assert.Equal(other with { Notes = "Myo-reps" }, patched);
    }

    [Fact]
    public void Becoming_a_warm_up_or_an_amrap_set_carries_the_effort_that_type_sets()
    {
        var warmup = PrescriptionDelta.Between([Set()], [Set(reps: 12) with { Warmup = true, TargetRpe = null, Rir = null }]);
        var asWarmup = warmup.Apply([Set(reps: 5) with { TargetRpe = 9 }])[0];
        Assert.True(asWarmup.Warmup);
        Assert.Null(asWarmup.Rir);
        Assert.Null(asWarmup.TargetRpe);
        Assert.Equal(5, asWarmup.RepMin);

        var amrap = PrescriptionDelta.Between([Set()], [Set(notes: "To failure / AMRAP", reps: 12) with { TargetRpe = 10, Rir = "0" }]);
        var asAmrap = amrap.Apply([Set(reps: 5)])[0];
        Assert.Equal("0", asAmrap.Rir);
        Assert.Equal(10, asAmrap.TargetRpe);
        Assert.Equal(5, asAmrap.RepMin);
    }

    [Fact]
    public void A_set_added_or_removed_is_still_structure_whatever_its_reps()
    {
        Assert.True(PrescriptionDelta.Between([Set()], [Set(), Set(reps: 12)]).Changed);
        Assert.True(PrescriptionDelta.Between([Set(), Set(reps: 12)], [Set()]).Changed);
    }
}
