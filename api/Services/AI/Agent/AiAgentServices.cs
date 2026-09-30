namespace Workout.Api.Services.AI.Agent;

// The tool-calling engine's collaborators, injected into AiAssistantService as one dependency.
public sealed class AiAgentServices
{
    public AiAgentServices(
        AiAgentEngine engine,
        AiBaselineSnapshotBuilder snapshot,
        AiChatUsageMeter usage)
    {
        Engine = engine;
        Snapshot = snapshot;
        Usage = usage;
    }

    public AiAgentEngine Engine { get; }
    public AiBaselineSnapshotBuilder Snapshot { get; }
    public AiChatUsageMeter Usage { get; }
}
