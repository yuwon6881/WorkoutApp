using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Workout.Api.Data;
using Workout.Api.Domain;
using Workout.Api.Endpoints;
using Workout.Api.Services;
using OpenIddict.Validation.AspNetCore;

var builder=WebApplication.CreateBuilder(args);
if(int.TryParse(Environment.GetEnvironmentVariable("PORT"),out var cloudRunPort))builder.WebHost.UseUrls($"http://0.0.0.0:{cloudRunPort}");
builder.Configuration.AddJsonFile("appsettings.Local.json",optional:true,reloadOnChange:false);
if(!builder.Environment.IsDevelopment()&&(!Uri.TryCreate(builder.Configuration["PublicOrigin"],UriKind.Absolute,out var publicOrigin)||publicOrigin.Scheme!="https"))
    throw new InvalidOperationException("PublicOrigin must be the exact public HTTPS origin in production.");
// A program PDF is capped at 20 MB; the margin covers multipart framing only.
builder.WebHost.ConfigureKestrel(o=>o.Limits.MaxRequestBodySize=21_500_000);
builder.Services.Configure<ForwardedHeadersOptions>(o=> { o.ForwardedHeaders=ForwardedHeaders.XForwardedProto; });
builder.Services.AddDbContext<AppDb>(o=>
{
    var connection=builder.Configuration.GetConnectionString("Database");
    if(!string.IsNullOrWhiteSpace(connection)) o.UseNpgsql(ConnectionSettings.Normalize(connection));
    else if(builder.Environment.IsDevelopment()) o.UseSqlite("Data Source="+(builder.Configuration["Database:SqlitePath"]??"workout.db"));
    else throw new InvalidOperationException("ConnectionStrings:Database must be configured in production.");
});
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<CatalogService>();
builder.Services.AddScoped<TemplateService>();
builder.Services.AddScoped<ProgramService>();
builder.Services.AddScoped<ProgressionService>();
builder.Services.AddScoped<NutritionContextService>();
builder.Services.AddScoped<SharedAccessTokenService>();
builder.Services.AddScoped<OpenIddictAccessTokenService>();
builder.Services.AddHttpClient<IIntegrationKms, IntegrationKmsService>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddScoped<IntegrationTokenService>();
builder.Services.AddScoped<WorkoutService>();
builder.Services.AddScoped<ExportService>();
builder.Services.AddScoped<ImportService>();
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme;
});
builder.Services.AddOpenIddict().AddValidation(options =>
{
    options.SetIssuer(new Uri(builder.Configuration["Identity:Issuer"] ?? "http://fitness-account"));
    options.AddAudiences(
        builder.Configuration["Identity:WorkoutAudience"] ?? "workout-api",
        builder.Configuration["Identity:NutritionAudience"] ?? "nutrition-api");
    options.UseSystemNetHttp();
    options.UseAspNetCore();
});
builder.Services.AddHttpClient<WorkoutAi>(c=>c.Timeout=TimeSpan.FromSeconds(150));
builder.Services.AddHttpClient("nutrition", c => c.Timeout = TimeSpan.FromSeconds(3));
builder.Services.AddHttpClient("fitness-account", c => c.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddRateLimiter(o=>
{
    o.RejectionStatusCode=429;
    // Without this a rejected request is an empty 429 and the app can only say "something went
    // wrong", which reads like a bug rather than a limit the user can simply wait out.
    o.OnRejected=async(context,token)=>
    {
        context.HttpContext.Response.StatusCode=429;
        context.HttpContext.Response.Headers.CacheControl="no-store";
        await context.HttpContext.Response.WriteAsJsonAsync(new { message="That was a lot of requests in a short time. Wait a minute and try again." },token);
    };
    o.AddPolicy("ai",http=>RateLimitPartition.GetFixedWindowLimiter(
        string.IsNullOrEmpty(http.Request.Cookies[AuthService.Cookie])?"unauthenticated":AuthService.Hash(http.Request.Cookies[AuthService.Cookie]!),
        _=>new FixedWindowRateLimiterOptions { PermitLimit=6,Window=TimeSpan.FromMinutes(5),QueueLimit=0 }));
    o.AddPolicy("ai-extract",http=>RateLimitPartition.GetFixedWindowLimiter(
        string.IsNullOrEmpty(http.Request.Cookies[AuthService.Cookie])?"unauthenticated":AuthService.Hash(http.Request.Cookies[AuthService.Cookie]!),
        _=>new FixedWindowRateLimiterOptions { PermitLimit=40,Window=TimeSpan.FromMinutes(5),QueueLimit=0 }));
    o.AddPolicy("export",http=>RateLimitPartition.GetFixedWindowLimiter(
        string.IsNullOrEmpty(http.Request.Cookies[AuthService.Cookie])?"unauthenticated":AuthService.Hash(http.Request.Cookies[AuthService.Cookie]!),
        _=>new FixedWindowRateLimiterOptions { PermitLimit=5,Window=TimeSpan.FromMinutes(5),QueueLimit=0 }));
});
var app=builder.Build();
app.UseForwardedHeaders();
app.UseAuthentication();
app.Use(async(http,next)=>
{
    http.Response.Headers.XContentTypeOptions="nosniff";
    if(!app.Environment.IsDevelopment()) http.Response.Headers.StrictTransportSecurity="max-age=31536000";
    http.Response.Headers["Referrer-Policy"]="same-origin";
    http.Response.Headers.ContentSecurityPolicy="default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    if(http.Request.Path.StartsWithSegments("/api")) http.Response.Headers.CacheControl="no-store";
    try
    {
        if(!HttpMethods.IsGet(http.Request.Method)&&!HttpMethods.IsHead(http.Request.Method)&&http.Request.Path.StartsWithSegments("/api"))
        {
            var origin=http.Request.Headers.Origin.ToString();
            var allowed=builder.Configuration["PublicOrigin"]??$"{http.Request.Scheme}://{http.Request.Host}";
            Validation.Require(origin==allowed&&http.Request.Headers["X-Workout-Request"]=="1","Request origin is not allowed.",403);
        }
        if(http.Request.Path.StartsWithSegments("/api") && !http.Request.Path.StartsWithSegments("/api/integrations/v1") && http.Request.Path.Value is not ("/api/auth/dev-reset" or "/api/auth/central/start" or "/api/auth/central/callback"))
        {
            var db=http.RequestServices.GetRequiredService<AppDb>();
            var token=http.Request.Cookies[AuthService.Cookie];
            Validation.Require(!string.IsNullOrEmpty(token),"Sign in to load your training.",401);
            var hash=AuthService.Hash(token!);
            var session=await db.Sessions.AsNoTracking().SingleOrDefaultAsync(s=>s.Hash==hash&&s.Expires>DateTime.UtcNow,http.RequestAborted);
            Validation.Require(session!=null,"Your session expired. Sign in again to continue.",401);db.CurrentUser=session!.UserId;
        }
        await next();
    }
    catch(DomainException ex) { http.Response.StatusCode=ex.Status;await http.Response.WriteAsJsonAsync(new { message=ex.Message }); }
    catch(DbUpdateConcurrencyException) { http.Response.StatusCode=409;await http.Response.WriteAsJsonAsync(new { message="This workout changed on another device. Refresh to see the newer version before saving." }); }
    catch(DbUpdateException) { http.Response.StatusCode=409;await http.Response.WriteAsJsonAsync(new { message="This record conflicts with saved data. Refresh and review before retrying." }); }
    catch(System.Text.Json.JsonException) { http.Response.StatusCode=400;await http.Response.WriteAsJsonAsync(new { message="Invalid data format." }); }
});
app.UseRateLimiter();
app.UseDefaultFiles();app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse=c=> { if(c.File.Name=="sw.js"||c.File.Name=="index.html") c.Context.Response.Headers.CacheControl="no-cache"; } });
app.MapAuth();app.MapCentralAuth();app.MapBootstrap();app.MapCatalog();app.MapTemplates();app.MapPrograms();app.MapWorkouts();app.MapImports();app.MapIntegrations();
app.MapGet("/health",()=>new { status="ok" });
app.MapFallback(async http=>
{
    if(http.Request.Path.StartsWithSegments("/api")||Path.HasExtension(http.Request.Path)) { http.Response.StatusCode=404;return; }
    var file=Path.Combine(app.Environment.WebRootPath??"wwwroot","index.html");
    if(!File.Exists(file)) { http.Response.StatusCode=404;return; }
    http.Response.ContentType="text/html";http.Response.Headers.CacheControl="no-cache";await http.Response.SendFileAsync(file);
});
await using(var scope=app.Services.CreateAsyncScope())
{
    var db=scope.ServiceProvider.GetRequiredService<AppDb>();
    if(db.Database.IsSqlite()&&app.Environment.IsDevelopment()) await db.Database.EnsureCreatedAsync();
    else if(builder.Configuration.GetValue("Database:MigrateOnStartup",true)||args.Contains("--migrate-only")||args.Any(a=>a.StartsWith("--seed-exercises=",StringComparison.Ordinal)))
    {
        var rawConn=builder.Configuration.GetConnectionString("Database");
        if(!string.IsNullOrWhiteSpace(rawConn))
        {
            await using var migrateDb=new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql(ConnectionSettings.Direct(rawConn)).Options);
            await migrateDb.Database.MigrateAsync();
        }
        else await db.Database.MigrateAsync();
    }
    var seedArgument=args.FirstOrDefault(a=>a.StartsWith("--seed-exercises=",StringComparison.Ordinal));
    if(seedArgument!=null)
    {
        var report=await CatalogSeed.Run(db,seedArgument["--seed-exercises=".Length..],args.Contains("--deactivate-missing"),CancellationToken.None);
        Console.WriteLine(report);
        return;
    }
}
if(args.Contains("--migrate-only")) return;
app.Run();
public partial class Program;
