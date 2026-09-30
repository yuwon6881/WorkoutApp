using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Endpoints;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class TrackRirTests
{
    [Fact]
    public void Preferences_keep_rir_tracking_when_an_older_client_omits_it()
    {
        var user = new AppUser();
        Assert.True(user.TrackRir);

        new PreferencesInput("kg", "dark", TrackRir: false).ApplyTo(user);
        Assert.False(user.TrackRir);

        new PreferencesInput("lb", "light").ApplyTo(user);
        Assert.False(user.TrackRir);
        Assert.Equal("lb", user.Unit);

        new PreferencesInput("lb", "light", TrackRir: true).ApplyTo(user);
        Assert.True(user.TrackRir);
    }

    [Fact]
    public void Review_drops_only_rir_target_items_when_tracking_is_off()
    {
        List<ImportReviewIssue> issues =
        [
            new("rpe_unread", "", "warning"),
            new("rpe_unspecified", "", "info"),
            new("percentage_load_without_rpe", "", "info"),
            new("rest_unread", "", "warning")
        ];

        Assert.Equal(4, ImportReviewPolicy.ForReview(issues, trackRir: true).Count);
        Assert.Equal(["rest_unread"], ImportReviewPolicy.ForReview(issues, trackRir: false).Select(issue => issue.Code));
    }

    [Fact]
    public async Task An_unread_rir_target_blocks_creation_only_while_rir_is_tracked()
    {
        await using var h = await Harness.Create();
        var user = await h.SignIn();
        await h.Seed(new SeedExercise("squat", "Squat", "Quads", "Barbell", "", null));
        var squat = await h.ExerciseId("squat");
        var set = new DraftSet(5, 5, null, 120, null, null, null, RpeSource: "inferred");
        var day = new DraftWorkout(Guid.NewGuid(), 1, "Lower", null, null,
            [new DraftExercise(Guid.NewGuid(), "Squat", squat, null, [set])]);
        var draft = Json.Write(new ImportDraft("Strength", [day]));
        var import = new AiImport { Id = Guid.NewGuid(), UserId = user.Id, Status = ImportStatus.Ready, DraftJson = draft };
        h.Db.Imports.Add(import);
        await h.Db.SaveChangesAsync();
        var imports = h.Imports(new NoProvider());

        var tracked = await imports.Get(import.Id, default);
        Assert.Contains(tracked.ReviewIssues!, issue => issue.Code == "rpe_unread");
        Assert.False(tracked.Acceptable);

        var row = await h.Db.Users.SingleAsync(u => u.Id == user.Id);
        row.TrackRir = false;
        await h.Db.SaveChangesAsync();

        var untracked = await imports.Get(import.Id, default);
        Assert.DoesNotContain(untracked.ReviewIssues!, issue => issue.Code.StartsWith("rpe_", StringComparison.Ordinal));
        Assert.True(untracked.Acceptable);
        var program = await imports.Accept(import.Id, default);
        Assert.Equal("Strength", program.Name);
    }

    /// Review and acceptance never call the model provider.
    private sealed class NoProvider : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => throw new InvalidOperationException("No provider call is expected.");
    }
}
