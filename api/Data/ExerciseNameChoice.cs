namespace Workout.Api.Data;

/// The library exercise this account means by a written exercise name. A program that writes
/// "High-Bar Squat" means the lifter's own "Squat" once they have linked it that way in a review;
/// every later import then links that name the same way, so the movement keeps one exercise and
/// one progression history instead of starting a second one. NameKey is the normalised written
/// name (`CatalogService.Normalize`), the same key the library index is read with.
public sealed class ExerciseNameChoice : OwnedRecord
{
    public string NameKey { get; set; } = "";
    public Guid ExerciseId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class ExerciseNameChoiceLimits
{
    public const int NameKeyLength = 160;
}
