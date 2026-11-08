using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ExternalImportPromptTests
{
    [Fact]
    public void Prompt_includes_the_validator_limits_and_provider_neutral_workflow()
    {
        var prompt = ExternalImportPrompt.Text;
        Assert.Contains($"At most {ExternalImportLimits.MaxDays} days total", prompt);
        Assert.Contains($"At most {ExternalImportLimits.MaxSubstitutions} substitutions per exercise", prompt);
        Assert.Contains($"requires at least {ExternalImportLimits.MinSets} set", prompt);
        Assert.Contains($"within 0-{ExternalImportLimits.MaxRir}", prompt);
        Assert.Contains($"sourceWeekDays (1-{ExternalImportLimits.MaxCycleDays})", prompt);
        Assert.Contains($"each group needs at least {ExternalImportLimits.MinSupersetExercises} exercises", prompt);
        foreach (var host in ImportDemoLinks.ApprovedHosts) Assert.Contains(host, prompt);
        foreach (var instruction in new[] { "complete source", "uncertain", "weeks", "days", "exercises", "parts", "merge", "one JSON file", "overlap", "nested" })
            Assert.Contains(instruction, prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Prompt_makes_the_format_decisions_itself_instead_of_questioning_a_non_technical_user()
    {
        var prompt = ExternalImportPrompt.Text;
        Assert.Contains("Do not ask the user any questions", prompt);
        Assert.Contains("plain, everyday language", prompt);
        // The old instructions told the assistant to question the user; none of that may remain.
        Assert.DoesNotContain("Ask about genuine ambiguities", prompt);
        // Every mention of asking the user must be a prohibition ("do not ask ...").
        Assert.DoesNotMatch(@"(?<!not )\bask the user", prompt);
        Assert.DoesNotContain("ask the user how to proceed", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("lowest number")]                         // a range of set counts
    [InlineData("that many sets of type warmup")]         // count-only warm-ups
    [InlineData("separate consecutive exercises")]        // top set and back-off rows
    [InlineData("up to 2 in total")]                      // alternatives beyond the limit
    [InlineData("only where the source prints one")]      // rest days are not padded
    [InlineData("Optional")]                              // optional days and exercises
    [InlineData("the app asks the user which to follow")] // versions such as Week 10A and 10B
    [InlineData("repsText")]                              // 3/3, 10 sec and similar notation
    public void Prompt_states_a_default_for_each_decision_the_assistant_would_otherwise_ask_about(string rule)
        => Assert.Contains(rule, ExternalImportPrompt.Text);

    [Fact]
    public void Prompt_limits_the_final_message_to_a_short_plain_summary()
        => Assert.Contains("at most three short sentences", ExternalImportPrompt.Text);
}
