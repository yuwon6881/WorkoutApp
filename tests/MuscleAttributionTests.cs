using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public class MuscleAttributionTests
{
    [Theory]
    [InlineData("Standing Calf Raise", "Traps, calves, and hips", "Calves")]
    [InlineData("Copenhagen Hip Adduction", "Adductors and neck", "Adductors")]
    [InlineData("DB Wrist Curl", "Biceps and forearms", "Forearms")]
    [InlineData("Seated Hamstring Curl", "Posterior chain", "Hamstrings")]
    [InlineData("Seated Hip Abduction", "Traps, calves, and hips", "Abductors")]
    [InlineData("Lateral Band Walk", "Traps, calves, and hips", "Abductors")]
    public void Compound_primary_buckets_refine_from_exercise_names(string name, string primary, string expected)
    {
        var credits = MuscleAttribution.For(name, primary, null);
        var credit = Assert.Single(credits);
        Assert.Equal(expected, credit.Region);
        Assert.Equal(MuscleAttribution.PrimaryWeight, credit.Weight);
    }

    [Fact]
    public void Multi_region_keyword_refinement_credits_each_direct_region_at_full_weight()
    {
        var credits = MuscleAttribution.For("Romanian Deadlift", "Posterior chain", null)
            .ToDictionary(credit => credit.Region, credit => credit.Weight);

        Assert.Equal(1, credits[MuscleRegions.Hamstrings]);
        Assert.Equal(1, credits[MuscleRegions.Glutes]);
        Assert.Equal(0.5, credits[MuscleRegions.Back]);
    }

    [Fact]
    public void Unknown_free_text_with_an_unrecognisable_name_stays_unattributed()
    {
        Assert.Empty(MuscleAttribution.For("Mystery movement", "Alien Muscle", null));
    }

    [Fact]
    public void Unmatched_import_uses_specific_name_refinement_without_generic_curl_overlap()
    {
        var credits = MuscleAttribution.For("Leg Curl", null, null);

        var credit = Assert.Single(credits);
        Assert.Equal(MuscleRegions.Hamstrings, credit.Region);
        Assert.Equal(1, credit.Weight);
    }

    [Fact]
    public void Leg_press_calf_variants_do_not_pick_up_the_glute_movement_estimate()
    {
        var credits = MuscleAttribution.For("Leg Press Calf Press", "Traps, calves, and hips", null);

        var credit = Assert.Single(credits);
        Assert.Equal(MuscleRegions.Calves, credit.Region);
    }

    [Fact]
    public void Catalog_and_movement_secondaries_credit_half_weight_without_duplicating_primary()
    {
        var credits = MuscleAttribution.For("Barbell Bench Press", "Chest", ["Chest", "Triceps"])
            .ToDictionary(credit => credit.Region, credit => credit.Weight);

        Assert.Equal(3, credits.Count);
        Assert.Equal(1, credits[MuscleRegions.Chest]);
        Assert.Equal(0.5, credits[MuscleRegions.Triceps]);
        Assert.Equal(0.5, credits[MuscleRegions.Shoulders]);
    }

    [Theory]
    [InlineData("Banded Clamshell")]
    [InlineData("Monster Walk")]
    [InlineData("Hip Abductor Machine")]
    [InlineData("Cable Hip Abduction")]
    public void Unmatched_abduction_imports_credit_abductors_rather_than_glutes(string name)
    {
        var credit = Assert.Single(MuscleAttribution.For(name, null, null));
        Assert.Equal(MuscleRegions.Abductors, credit.Region);
        Assert.Equal(MuscleAttribution.PrimaryWeight, credit.Weight);
    }

    [Fact]
    public void Adduction_stays_with_adductors_beside_the_new_abductor_region()
    {
        var credit = Assert.Single(MuscleAttribution.For("Hip Adduction", null, null));
        Assert.Equal(MuscleRegions.Adductors, credit.Region);
    }

    [Fact]
    public void Unilateral_stance_secondary_credits_abductors_without_moving_glute_credit()
    {
        var credits = MuscleAttribution.For("DB Bulgarian Split Squat", "Quads", ["Abductors"])
            .ToDictionary(credit => credit.Region, credit => credit.Weight);

        Assert.Equal(1, credits[MuscleRegions.Quads]);
        Assert.Equal(0.5, credits[MuscleRegions.Glutes]);
        Assert.Equal(0.5, credits[MuscleRegions.Abductors]);
    }

    [Fact]
    public void Abductors_sit_between_glutes_and_quads_in_canonical_order()
    {
        var all = MuscleRegions.All.ToList();
        Assert.Equal(all.IndexOf(MuscleRegions.Glutes) + 1, all.IndexOf(MuscleRegions.Abductors));
    }

    [Fact]
    public void Unrefined_compound_bucket_uses_an_even_primary_split_as_a_last_resort()
    {
        var credits = MuscleAttribution.For("Unknown posterior exercise", "Posterior chain", null)
            .ToDictionary(credit => credit.Region, credit => credit.Weight);

        Assert.Equal(0.5, credits[MuscleRegions.Hamstrings]);
        Assert.Equal(0.5, credits[MuscleRegions.Glutes]);
    }
}
