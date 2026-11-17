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
    public void A_set_added_or_removed_is_still_structure_whatever_its_reps()
    {
        Assert.True(PrescriptionDelta.Between([Set()], [Set(), Set(reps: 12)]).Changed);
        Assert.True(PrescriptionDelta.Between([Set(), Set(reps: 12)], [Set()]).Changed);
    }
}
