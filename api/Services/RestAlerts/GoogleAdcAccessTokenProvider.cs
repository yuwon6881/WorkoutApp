using System.Collections.Concurrent;
using Google.Apis.Auth.OAuth2;

namespace Workout.Api.Services.RestAlerts;

/// <summary>Uses the attached Cloud Run identity in production and ADC in local development.</summary>
public sealed class GoogleAdcAccessTokenProvider : IGoogleAccessTokenProvider
{
    private readonly ConcurrentDictionary<string, Lazy<Task<GoogleCredential>>> credentials = new(StringComparer.Ordinal);

    public async Task<string> GetAccessTokenAsync(string scope, CancellationToken ct)
    {
        var credentialTask = credentials.GetOrAdd(scope, requestedScope => new Lazy<Task<GoogleCredential>>(
            () => CreateCredentialAsync(requestedScope), LazyThreadSafetyMode.ExecutionAndPublication));
        var credential = await credentialTask.Value;
        return await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
    }

    private static async Task<GoogleCredential> CreateCredentialAsync(string scope)
    {
        var credential = await GoogleCredential.GetApplicationDefaultAsync();
        return credential.IsCreateScopedRequired ? credential.CreateScoped(scope) : credential;
    }
}
