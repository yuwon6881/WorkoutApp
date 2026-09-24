namespace Workout.Api.Domain;

/// The shape a stored program can take.
public static class ProgramLimits
{
    /// An ordinary training week has seven days.
    public const int StandardDaysPerWeek = 7;

    /// A program printed on a longer asynchronous cycle (a ten-day Push/Pull/Legs/Arms rotation)
    /// keeps the week its PDF prints, so a week may hold more than seven days, up to two weeks' worth.
    public const int MaxDaysPerWeek = 14;
}
