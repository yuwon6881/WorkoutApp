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
    string SequenceGroup = "", List<string>? Substitutions = null, int? SourcePage = null);

public record DraftWorkout(
    Guid LineId, int Week, string Name, string? Focus, string? Notes, List<DraftExercise> Exercises,
    string? Block = null, string? Phase = null, int PhaseWeek = 1, bool IsRestDay = false,
    int? Weekday = null, int? SourcePage = null);

public record ImportDraft(string ProgramName, List<DraftWorkout> Workouts);
public record ImportMetadata(string ProgramName);
public record UnresolvedExercise(Guid LineId, string SourceName);
public record ImportReviewIssue(
    string Code,
    string Message,
    string Severity = "warning",
    int? SourcePage = null,
    Guid? WorkoutLineId = null,
    Guid? ExerciseLineId = null,
    int? SetIndex = null,
    string? TargetField = null);
public record ImportAlternative(string Id, string Name, int ChunkCount, int DayCount, List<ImportChunk>? Chunks = null);
public record ImportRestoreInput(int? Revision = null);

public record ImportView(
    Guid Id, string Status, string FileName, int Pages, string Error, DateTime Created, string Model,
    string Stage, int ChunksDone, int ChunksTotal, string? CurrentChunkLabel, int UnresolvedCount, ImportDraft? Draft,
    List<UnresolvedExercise> Unresolved, bool Acceptable, Guid? ProgramId, List<ImportReviewIssue>? ReviewIssues = null,
    long InputTokens = 0, long OutputTokens = 0, int Retries = 0,
    DateTime? SourceExpiresAt = null, List<PdfPageCoverage>? PageCoverage = null,
    List<ImportAlternative>? Alternatives = null, string? SelectedAlternativeId = null,
    int Revision = 0, bool CanRestoreDraft = false, List<Guid>? RestorableExerciseLineIds = null);
