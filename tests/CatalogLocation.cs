namespace Workout.Tests;

/// Where the seeded exercise catalog lives, found by walking up from the test output so it works from any
/// build folder. One copy, shared by the catalog, corpus and accuracy tests.
internal static class CatalogLocation
{
    public static string Path()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent)
            {
                var candidate = System.IO.Path.Combine(directory.FullName, "deploy", "exercises.json");
                if (File.Exists(candidate)) return candidate;
            }
        }
        throw new InvalidOperationException("deploy/exercises.json was not found.");
    }
}
