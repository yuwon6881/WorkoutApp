namespace Workout.Api.Services;

/// A day read from a document, brought into the shape a stored day has.
///
/// The document decides what a program says; this app decides what it can hold. Those disagree
/// constantly, and in ways that are the document being a document rather than the read going
/// wrong: a page prints "REST" without calling it a rest day, a finisher is listed with no sets
/// prescribed at all, a dense table runs more movements or more sets into one session than a
/// stored day or exercise can carry.
///
/// Every one of those used to refuse something — a section, or the finished draft at the very end
/// of a read — with a message about what "AI returned". A refusal at the end is the worst of them:
/// the retry re-reads the last section while the offending day sits in the draft from an earlier
/// one, so the import can never finish however many times it is tried. So each is reconciled here
/// and reported to the reviewer instead, and nothing a page actually said is thrown away silently.
internal static class ImportDayShape
{
    /// What one stored day and one stored exercise can hold. They mirror the draft's own limits;
    /// a read that exceeds them is trimmed to fit rather than refused.
    public const int MaxDayExercises = 40;
    public const int MaxExerciseSets = 24;

    public static (List<DraftWorkout> Workouts, List<ImportReviewIssue> Notices) Reconcile(IEnumerable<DraftWorkout> days)
    {
        var notices = new List<ImportReviewIssue>();
        var workouts = new List<DraftWorkout>();
        foreach (var day in days) workouts.Add(ReconcileDay(day, notices));
        return (workouts, notices);
    }

    private static DraftWorkout ReconcileDay(DraftWorkout day, List<ImportReviewIssue> notices)
    {
        if (day.IsRestDay) return day;
        if (day.Exercises.Count == 0)
        {
            // A page regularly documents a day with nothing to train — "REST", "OFF", a recovery
            // note — and the read comes back with an empty exercise list and no rest-day flag,
            // which is the document saying the same thing in its own words.
            notices.Add(new ImportReviewIssue("day_without_exercises",
                $"{day.Name} was read with no exercises, so it is kept as a rest day. Add them in the review if that page lists any.",
                "warning", day.SourcePage, WorkoutLineId: day.LineId, TargetField: "exercises"));
            return day with { IsRestDay = true };
        }

        var exercises = day.Exercises;
        if (exercises.Count > MaxDayExercises)
        {
            notices.Add(new ImportReviewIssue("day_exercises_trimmed",
                $"{day.Name} was read with {exercises.Count} exercises and a day holds {MaxDayExercises}; the rest were left out. Check that page in the review.",
                "warning", day.SourcePage, WorkoutLineId: day.LineId, TargetField: "exercises"));
            exercises = exercises.Take(MaxDayExercises).ToList();
        }
        return day with { Exercises = exercises.Select(exercise => ReconcileExercise(exercise, day, notices)).ToList() };
    }

    private static DraftExercise ReconcileExercise(DraftExercise exercise, DraftWorkout day, List<ImportReviewIssue> notices)
    {
        if (exercise.Sets.Count > MaxExerciseSets)
        {
            notices.Add(new ImportReviewIssue("exercise_sets_trimmed",
                $"{exercise.SourceName} in {day.Name} was read with {exercise.Sets.Count} sets and an exercise holds {MaxExerciseSets}; the rest were left out. Check that page in the review.",
                "warning", exercise.SourcePage ?? day.SourcePage, WorkoutLineId: day.LineId,
                ExerciseLineId: exercise.LineId, TargetField: "sets"));
            return exercise with { Sets = exercise.Sets.Take(MaxExerciseSets).ToList() };
        }
        if (exercise.Sets.Count > 0) return exercise;

        // A program lists movements it never prescribes sets for: a timed finisher, a conditioning
        // line, a mobility drill written as a sentence. The movement is what the page said, so it
        // is kept with one set that claims nothing and is marked as this app's own suggestion.
        notices.Add(new ImportReviewIssue("exercise_without_sets",
            $"{exercise.SourceName} in {day.Name} was read with no prescribed sets, so it has one unspecified set. Check that page in the review.",
            "warning", exercise.SourcePage ?? day.SourcePage, WorkoutLineId: day.LineId,
            ExerciseLineId: exercise.LineId, SetIndex: 0, TargetField: "repMin"));
        return exercise with { Sets = [Unspecified(exercise.SourcePage ?? day.SourcePage)] };
    }

    /// One set that states nothing the page did not: a single rep as the only bound a stored set
    /// can hold, and no RPE or rest invented to go with it.
    private static DraftSet Unspecified(int? sourcePage)
        => new(1, 1, null, null, null, null, null, "inferred", "inferred", "inferred", SourcePage: sourcePage);

    /// Page numbers the document cannot have. The model counts pages from the markers in the text
    /// it was given and occasionally lands past the end of the document; a citation that leads
    /// nowhere is worth dropping, and worth far less than the read it used to fail. This runs on
    /// the whole draft at the end of a read, because a page reported by an early section is one no
    /// retry of a later section could ever reach.
    public static (ImportDraft Draft, List<ImportReviewIssue> Notices) ReconcilePages(ImportDraft draft, int pageCount)
    {
        if (pageCount <= 0) return (draft, []);
        var dropped = 0;
        int? Cite(int? page)
        {
            if (page is null || page.Value <= pageCount) return page;
            dropped++;
            return null;
        }
        var workouts = draft.Workouts.Select(day => day with
        {
            SourcePage = Cite(day.SourcePage),
            Exercises = day.Exercises.Select(exercise => exercise with
            {
                SourcePage = Cite(exercise.SourcePage),
                Sets = exercise.Sets.Select(set => set with { SourcePage = Cite(set.SourcePage) }).ToList()
            }).ToList()
        }).ToList();
        if (dropped == 0) return (draft, []);
        return (draft with { Workouts = workouts }, [new ImportReviewIssue("source_page_outside_pdf",
            $"{dropped} reference{(dropped == 1 ? "" : "s")} pointed to a page this PDF does not have, so {(dropped == 1 ? "it was" : "they were")} left blank. Everything read from those rows is kept.",
            "warning", null)]);
    }
}
