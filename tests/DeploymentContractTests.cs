using Xunit;

namespace Workout.Tests;

public sealed class DeploymentContractTests
{
    [Fact]
    public void Cloud_Run_deployments_use_http1_until_h2c_is_explicitly_configured()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "cloudbuild.yaml"));

        Assert.DoesNotContain("'--use-http2'", build);
    }

    [Fact]
    public void Import_worker_uses_tasks_and_scales_to_zero()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "cloudbuild.yaml"));

        Assert.DoesNotContain("'--min-instances=1'", build);
        Assert.Contains("ImportWorker__Enabled=true,ImportWorker__PollingEnabled=false", build);
        Assert.Contains("_IMPORT_BUCKET: 'workout-imports-396431756440'", build);
        Assert.Contains("_IMPORT_TASK_QUEUE: 'workout-imports'", build);
        Assert.Contains("/internal/import-tasks", build);
        var dispatcher = File.ReadAllText(Path.Combine(RepositoryRoot(), "api", "Services", "ImportJobDispatcher.cs"));
        Assert.Contains("dispatchDeadline = \"1800s\"", dispatcher);
    }

    [Fact]
    public void Frontend_and_api_csp_explicitly_keep_styles_and_fonts_first_party()
    {
        var root = RepositoryRoot();
        var api = File.ReadAllText(Path.Combine(root, "api", "Program.cs"));
        var frontend = File.ReadAllText(Path.Combine(root, "web", "vercel.json"));
        var entry = File.ReadAllText(Path.Combine(root, "web", "src", "main.tsx"));

        Assert.Contains("style-src-elem 'self'", api);
        Assert.Contains("font-src 'self'", api);
        Assert.Contains("style-src-elem 'self'", frontend);
        Assert.Contains("font-src 'self'", frontend);
        Assert.Contains("@fontsource-variable/inter", entry);
        Assert.DoesNotContain("fonts.googleapis.com", entry);
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "cloudbuild.yaml")) &&
                File.Exists(Path.Combine(directory.FullName, "WorkoutApp.slnx")) &&
                Directory.Exists(Path.Combine(directory.FullName, "api"))) return directory.FullName;
        throw new DirectoryNotFoundException("WorkoutApp repository root was not found.");
    }
}
