using Xunit;

namespace Workout.Tests;

// Long-history fixtures must not occupy the shared local SQLite gate while timing-sensitive
// background-runner regressions are waiting for their mock provider.
[CollectionDefinition("Performance", DisableParallelization = true)]
public sealed class PerformanceCollection;
