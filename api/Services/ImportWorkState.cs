using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Import-only execution details. Section responses already have their own durable store; this
/// keeps progress and bounded recovery reservations without retaining another copy of the PDF.
internal sealed record ImportWorkState(
    DateTime? StartedAtUtc = null,
    DateTime? LastProgressAtUtc = null,
    Dictionary<int, string>? SectionStages = null,
    Dictionary<int, int>? RecoveryReads = null,
    Dictionary<int, List<ImportRecoveryCandidate>>? RecoveryCandidates = null)
{
    public static ImportWorkState Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new ImportWorkState();
        try { return Json.Read<ImportWorkState>(json) ?? new ImportWorkState(); }
        catch (System.Text.Json.JsonException) { return new ImportWorkState(); }
        catch (DomainException) { return new ImportWorkState(); }
    }

    public ImportProgressDetails Progress(int total, int completed, int sectionsWithResponses)
    {
        var stages = SectionStages ?? [];
        var reading = stages.Values.Count(stage => stage == "extract");
        var verifying = stages.Values.Count(stage => stage == "verify");
        var repairing = stages.Values.Count(stage => stage == "recover");
        var active = reading + verifying + repairing;
        var outstanding = Math.Max(completed, sectionsWithResponses);
        var queued = Math.Max(0, total - completed - Math.Max(active, outstanding - completed));
        return new ImportProgressDetails(completed, queued, reading, verifying, repairing,
            sectionsWithResponses, StartedAtUtc, LastProgressAtUtc);
    }
}

internal sealed record ImportRecoveryCandidate(int Attempt, AiImportResult Response, DateTime ReceivedAtUtc,
    List<string>? RepairReasons = null);
