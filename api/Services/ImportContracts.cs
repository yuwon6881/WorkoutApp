using Workout.Api.Domain;

namespace Workout.Api.Services;

public record DraftSet(
    int? RepMin, int? RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes,
    string RepsSource = "extracted", string RpeSource = "extracted", string RestSource = "extracted",
    string? RepsText = null, string? RestText = null, string? Rir = null,
    bool Warmup = false, int? SourcePage = null)
{
    private ImportSourceReference? sourceReference;
    public ImportSourceReference? SourceReference { get => sourceReference ?? ImportSourceReference.FromPage(SourcePage); init => sourceReference = value; }
    public ImportUncertainty? Uncertainty { get; init; }
}

public record DraftExercise(
    Guid LineId, string SourceName, Guid? ExerciseId, string? Notes, List<DraftSet> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, int? SourcePage = null,
    Guid? SlotKey = null, int? RestSeconds = null,
    /// A demonstration video the document links from this exercise name, when it carries one.
    string? DemoUrl = null, Dictionary<string, string>? DemoLinks = null,
    /// The written movement this row names, shared by every occurrence however a page cased or placed it.
    /// Derived on every save so the editor can offer an edit to the other occurrences without re-deriving it.
    string? MovementKey = null)
{
    private ImportSourceReference? sourceReference;
    public ImportSourceReference? SourceReference { get => sourceReference ?? ImportSourceReference.FromPage(SourcePage); init => sourceReference = value; }
    public ImportUncertainty? Uncertainty { get; init; }
}

public record DraftWorkout(
    Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false,
    int? SourcePage = null, Guid? BlockId = null, Guid? WeekId = null)
{
    private ImportSourceReference? sourceReference;
    public ImportSourceReference? SourceReference { get => sourceReference ?? ImportSourceReference.FromPage(SourcePage); init => sourceReference = value; }
}

/// SourceWeekDays is the longest week the source itself confirms (a ten-day cycle is 10); a week beyond
/// seven days is only accepted without review when its source says so.
public record ImportDraft(string ProgramName, List<DraftWorkout> Workouts, int? SourceWeekDays = null)
{
    public List<ImportAlternativeGroup>? AlternativeGroups { get; init; }
    public List<ImportAlternativeUncertainty>? AlternativeUncertainties { get; init; }
}
public record ImportMetadata(string ProgramName);
/// Days replaced together by one exercise edit; every day not named keeps its stored content.
public record ImportDaysInput(List<DraftWorkout>? Days, int? Revision);
/// One unresolved recurring slot, represented once even when the source repeats it in every week.
public record UnresolvedExercise(Guid LineId, string SourceName, Guid? SlotKey = null,
    string? Block = null, int Occurrences = 1);
public record ImportReviewIssue(
    string Code,
    string Message,
    string Severity = "warning",
    int? SourcePage = null,
    Guid? WorkoutLineId = null,
    Guid? ExerciseLineId = null,
    int? SetIndex = null,
    string? TargetField = null,
    int? ExpectedTrainingDays = null,
    int? SourcePageTo = null,
    int? WeekFrom = null,
    int? WeekTo = null);
/// One version the import offers to choose between; it names the draft days that belong to it.
public record ImportAlternative(
    string Id, string Name, int DayCount, string Kind = ImportAlternativeKinds.Program,
    string? Description = null, List<Guid>? DayLineIds = null)
{
    public ImportUncertainty? Uncertainty { get; init; }
}

public record ImportAlternativeGroup(string Id, List<ImportAlternative> Members);
public record ImportAlternativeUncertainty(string Name, ImportUncertainty Uncertainty);

public static class ImportAlternativeKinds
{
    public const string Program = "program";
    public const string Week = "week";
}
public record ImportRestoreInput(int? Revision = null);
public record ImportSlotMappingInput(Guid ExerciseLineId, Guid? ReplacementExerciseId, int? Revision = null);

public record ImportView(
    Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model,
    string Stage, int UnresolvedCount, ImportDraft? Draft,
    List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId, List<ImportReviewIssue>? ReviewIssues = null,
    List<ImportAlternative>? Alternatives = null, string? SelectedAlternativeId = null,
    int Revision = 0, bool CanRestoreDraft = false, List<Guid>? RestorableExerciseLineIds = null);
