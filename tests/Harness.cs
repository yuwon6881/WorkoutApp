using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Services;

namespace Workout.Tests;

/// An isolated in-memory database per test, wired the same way the request pipeline wires it.
public sealed class Harness : IAsyncDisposable
{
    private readonly SqliteConnection connection;
    public AppDb Db { get; }
    public IConfiguration Config { get; }
    public AuthService Auth { get; }
    public CatalogService Catalog { get; }
    public TemplateService Templates { get; }
    public ProgramService Programs { get; }
    public ProgressionService Progression { get; }
    public WorkoutService Workouts { get; }
    public ExportService Export { get; }

    private Harness(SqliteConnection connection, AppDb db, IConfiguration config)
    {
        this.connection = connection; Db = db; Config = config;
        Auth = new AuthService(db, config);
        Catalog = new CatalogService(db);
        Templates = new TemplateService(db, Catalog);
        Programs = new ProgramService(db, Templates);
        Progression = new ProgressionService(db);
        Workouts = new WorkoutService(db, Catalog, Templates, Progression,
            new NutritionContextService(db, new TestHttpClientFactory(), config));
        Export = new ExportService(db, Programs, Templates, Workouts);
    }

    public static async Task<Harness> Create(Dictionary<string, string?>? settings = null)
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings ?? []).Build();
        return new Harness(connection, db, config);
    }

    public async Task<AppUser> SignIn(string username = "alice", string password = "a long enough password")
    {
        var user = await Auth.Register(username, password, default);
        Db.CurrentUser = user.Id;
        return user;
    }

    public ImportService Imports(HttpMessageHandler handler)
        => new(Db, new WorkoutAi(new HttpClient(handler), Config), Catalog, Programs);

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
        await Db.DisposeAsync();
        await connection.DisposeAsync();
    }
}

file sealed class TestHttpClientFactory : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new();
}

/// Replays a canned OpenAI Responses payload without touching the network.
public sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public HttpRequestMessage? LastRequest { get; private set; }
    public int Calls { get; private set; }

    public static StubHandler Returning(string json) => new(_ => new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(json) });

    public static StubHandler Program(string body) => Returning($$"""
        {"status":"completed","usage":{"input_tokens":10,"output_tokens":20},
         "output":[{"content":[{"type":"output_text","text":{{System.Text.Json.JsonSerializer.Serialize(body)}}}]}]}
        """);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Calls++;
        LastRequest = request;
        if (request.Content != null) Body = await request.Content.ReadAsStringAsync(ct);
        return respond(request);
    }
    public string? Body { get; private set; }
}
