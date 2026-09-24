using Workout.Api.Domain;

namespace Workout.Api.Services;

public record ImportChunk(string Label, string? Block, string? Phase, int WeekFrom, int WeekTo, int PageFrom, int PageTo, int DayCount);

public record DraftSet(
    int RepMin, int RepMax, double? TargetRpe, int? RestSeconds, string? Tempo, string? LoadText, string? Notes,
    string RepsSource = "extracted", string RpeSource = "extracted", string RestSource = "extracted",
    string? RepsText = null, string? RestText = null, string? Rir = null,
    bool Warmup = false, int? SourcePage = null);

public record DraftExercise(
    Guid LineId, string SourceName, Guid? ExerciseId, string? Notes, List<DraftSet> Sets,
    string SequenceGroup = "", List<string>? Substitutions = null, int? SourcePage = null,
    Guid? SlotKey = null, int? RestSeconds = null,
    /// A demonstration video the document links from this exercise name, when it carries one.
    string? DemoUrl = null, Dictionary<string, string>? DemoLinks = null);

public record DraftWorkout(
    Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false,
    int? SourcePage = null, Guid? BlockId = null, Guid? WeekId = null);

/// SourceWeekDays is the longest week the PDF itself confirms (a ten-day cycle is 10); a week beyond
/// seven days is only accepted without review when its source says so.
public record ImportDraft(string ProgramName, List<DraftWorkout> Workouts, int? SourceWeekDays = null);
public record ImportMetadata(string ProgramName);
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
public record ImportAlternative(string Id, string Name, int ChunkCount, int DayCount, List<ImportChunk>? Chunks = null);
public record ImportRestoreInput(int? Revision = null);
public record ImportSlotMappingInput(Guid ExerciseLineId, Guid? ReplacementExerciseId, int? Revision = null);

public record ImportView(
    Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model,
    string Stage, int ChunksDone, int ChunksTotal, string? CurrentChunkLabel, int UnresolvedCount, ImportDraft? Draft,
    List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId, List<ImportReviewIssue>? ReviewIssues = null,
    long InputTokens = 0, long OutputTokens = 0, int Retries = 0,
    List<PdfPageCoverage>? PageCoverage = null,
    List<ImportAlternative>? Alternatives = null, string? SelectedAlternativeId = null,
    int Revision = 0, bool CanRestoreDraft = false, List<Guid>? RestorableExerciseLineIds = null);

/// Lightweight polling contract.  Extraction progress must not repeatedly serialize the
/// potentially large draft, page coverage, and review metadata; the full view is fetched only
/// when a draft or alternative selection is actually ready to display.
public record ImportStatusView(
    Guid Id, string Status, string Stage, int ChunksDone, int ChunksTotal,
    string? CurrentChunkLabel, string Error, int Revision, int Retries,
    int UnresolvedCount);
