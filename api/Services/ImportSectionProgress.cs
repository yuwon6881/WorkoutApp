using System.Collections.Concurrent;

namespace Workout.Api.Services;

/// What each in-flight section of one extraction pass is doing, and when that is written down.
///
/// A change to the import's visible stage is written before the section moves on, so a repair is
/// on record before its read starts. Changes inside the same stage only feed the progress display,
/// so a burst of them is coalesced into one write instead of queueing every section's next
/// provider request behind its own progress write.
internal sealed class ImportSectionProgress(
    Func<Func<string>, IReadOnlyDictionary<int, string>, Task<bool>> persist, ILogger? logger)
{
    /// How long a change waits for its neighbours' changes before one write records them all.
    /// Short enough that the next status poll still sees it.
    internal static readonly TimeSpan FlushDelay = TimeSpan.FromMilliseconds(300);

    private readonly ConcurrentDictionary<int, string> stages = new();
    private readonly List<Task> flushes = [];
    private volatile string persistedStage = "extract";
    private int flushQueued;

    public IReadOnlyDictionary<int, string> Stages => stages;

    /// False once a write found that this pass no longer owns the import.
    public bool LeaseHeld { get; private set; } = true;

    /// The import-level stage: any section still reading keeps the import reading.
    public string Resolve() => stages.Values.Contains("extract") ? "extract"
        : stages.Values.Contains("recover") ? "recover"
        : stages.Values.Contains("verify") ? "verify" : "extract";

    public Task Update(int index, string? stage)
    {
        if (stage is null) stages.TryRemove(index, out _);
        else stages[index] = stage;
        if (Resolve() != persistedStage) return Persist();
        if (Interlocked.Exchange(ref flushQueued, 1) == 1) return Task.CompletedTask;
        var flush = FlushSoon();
        lock (flushes) flushes.Add(flush);
        return Task.CompletedTask;
    }

    /// Waits for coalesced writes so none outlives the pass that queued it.
    public Task Settle()
    {
        Task[] queued;
        lock (flushes) queued = [.. flushes];
        return Task.WhenAll(queued);
    }

    private async Task Persist()
    {
        if (!await persist(() => persistedStage = Resolve(), stages)) LeaseHeld = false;
    }

    private async Task FlushSoon()
    {
        try
        {
            await Task.Delay(FlushDelay);
            Interlocked.Exchange(ref flushQueued, 0);
            await Persist();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Section progress is informational; each section's own writes still decide its result.
            logger?.LogWarning(ex, "Import section progress could not be saved.");
        }
    }
}
