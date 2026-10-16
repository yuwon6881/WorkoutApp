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

    /// `finalResults` are the sections whose chosen response is stored; `responses` also counts
    /// sections whose first response is stored but still being checked or repaired.
    public ImportProgressDetails Progress(int total, int completed, IReadOnlySet<int> finalResults, IReadOnlySet<int> responses)
    {
        var stages = SectionStages ?? [];
        var reading = stages.Values.Count(stage => stage == "extract");
        var verifying = stages.Values.Count(stage => stage == "verify");
        var repairing = stages.Values.Count(stage => stage == "recover");
        var sectionsWithResponses = Math.Max(completed, responses.Count);
        var states = Enumerable.Range(0, Math.Max(0, total)).Select(index =>
            index < completed ? ImportSectionStates.Committed
            : stages.TryGetValue(index, out var stage) ? stage switch
            {
                "verify" => ImportSectionStates.Checking,
                "recover" => ImportSectionStates.Repairing,
                _ => ImportSectionStates.Reading
            }
            : finalResults.Contains(index) ? ImportSectionStates.Saved
            : ImportSectionStates.Queued).ToList();
        // Counted from the same list the screen draws, so a saved section is never also queued.
        var queued = states.Count(state => state == ImportSectionStates.Queued);
        return new ImportProgressDetails(completed, queued, reading, verifying, repairing,
            sectionsWithResponses, StartedAtUtc, LastProgressAtUtc, states);
    }
}

internal sealed record ImportRecoveryCandidate(int Attempt, AiImportResult Response, DateTime ReceivedAtUtc,
    List<string>? RepairReasons = null);
