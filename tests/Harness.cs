using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Tests;

/// An isolated in-memory database per test, wired the same way the request pipeline wires it.
public sealed class Harness : IAsyncDisposable
{
    private readonly SqliteConnection connection;
    public AppDb Db { get; }
    private MemoryCache Cache { get; } = new(new MemoryCacheOptions());
    public IConfiguration Config { get; }
    public AuthService Auth { get; }
    public CatalogService Catalog { get; }
    public TemplateService Templates { get; }
    public ProgramProgressService ProgramProgress { get; }
    public ProgramService Programs { get; }
    public ProgramEditorService ProgramEditor { get; }
    public ProgressionService Progression { get; }
    public WorkoutService Workouts { get; }
    public MuscleBalanceService MuscleBalance { get; }
    public ActiveSlotService ActiveSlot { get; }

    private Harness(SqliteConnection connection, AppDb db, IConfiguration config)
    {
        this.connection = connection; Db = db; Config = config;
        Auth = new AuthService(db);
        Catalog = new CatalogService(db);
        MuscleBalance = new MuscleBalanceService(db, Catalog, Cache);
        Templates = new TemplateService(db, Catalog);
        ProgramProgress = new ProgramProgressService(db);
        var lifecycle = new ProgramLifecycleService(db, Templates, ProgramProgress);
        Programs = new ProgramService(db, Templates, ProgramProgress, lifecycle);
        ActiveSlot = new ActiveSlotService(db, Templates, lifecycle);
        ProgramEditor = new ProgramEditorService(Programs, db, Templates, ProgramProgress, lifecycle);
        Progression = new ProgressionService(db);
        Workouts = new WorkoutService(db, Catalog, Templates, Progression,
            new NutritionContextService(db, new TestHttpClientFactory(), config), Programs, readCache: Cache);
    }

    public static async Task<Harness> Create(Dictionary<string, string?>? settings = null, DbCommandInterceptor? observer = null)
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection);
        if (observer != null) options.AddInterceptors(observer);
        var db = new AppDb(options.Options);
        await db.Database.EnsureCreatedAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings ?? []).Build();
        return new Harness(connection, db, config);
    }

    public async Task<AppUser> CreateUser(string name = "alice", string? subject = null)
    {
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            DisplayName = name,
            IdentitySubject = subject ?? $"sub_{Guid.NewGuid():N}"
        };
        Db.Users.Add(user);
        await Db.SaveChangesAsync();
        return user;
    }

    public async Task<AppUser> SignIn(string username = "alice")
    {
        var user = await CreateUser(username);
        Db.CurrentUser = user.Id;
        return user;
    }

    public ImportService Imports() => new(Db, Catalog, Programs, Config);

    public async Task Seed(params SeedExercise[] exercises)
    {
        var user = Db.CurrentUser;
        Db.CurrentUser = null;
        await CatalogSeed.Apply(Db, exercises.ToList(), false, default);
        Db.ChangeTracker.Clear();
        Db.CurrentUser = user;
    }

    public async Task<Guid> ExerciseId(string slug)
        => (await Db.Exercises.AsNoTracking().SingleAsync(x => x.Slug == slug)).Id;

    public static SetPrescription Set(int min, int max, double? rpe = 8) => new(min, max, rpe, 90, null, null, null);

    public static TemplateInput Template(string name, params TemplateExerciseInput[] exercises)
        => new(name, "Focus", null, exercises.ToList(), null, null);

    public static TemplateExerciseInput Exercise(Guid? id, string name, params SetPrescription[] sets)
        => new(id, name, null, sets.ToList());

    public async ValueTask DisposeAsync()
    {
        Cache.Dispose();
        await Db.DisposeAsync();
        await connection.DisposeAsync();
    }
}

file sealed class TestHttpClientFactory : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new();
}
