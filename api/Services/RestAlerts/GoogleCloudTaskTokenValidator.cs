using Google.Apis.Auth;

namespace Workout.Api.Services.RestAlerts;

/// <summary>Fails closed unless the request carries an OIDC token from the configured task identity.</summary>
public sealed class GoogleCloudTaskTokenValidator(IConfiguration configuration, ILogger<GoogleCloudTaskTokenValidator> logger)
    : ICloudTaskTokenValidator
{
    public async Task<bool> IsTrustedAsync(string? authorizationHeader, CancellationToken ct)
    {
        var audience = configuration["CloudTasks:Audience"];
        var expectedEmail = configuration["CloudTasks:CallerServiceAccountEmail"];
        if (string.IsNullOrWhiteSpace(audience) || string.IsNullOrWhiteSpace(expectedEmail) ||
            string.IsNullOrWhiteSpace(authorizationHeader) ||
            !authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;

        var token = authorizationHeader["Bearer ".Length..].Trim();
        if (token.Length is < 64 or > 16_384) return false;
        try
        {
            ct.ThrowIfCancellationRequested();
            var payload = await GoogleJsonWebSignature.ValidateAsync(token, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [audience]
            });
            var trustedIssuer = payload.Issuer is "accounts.google.com" or "https://accounts.google.com";
            return trustedIssuer && payload.EmailVerified &&
                string.Equals(payload.Email, expectedEmail, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogInformation("Rejected an invalid Workout rest-task OIDC token ({ErrorType}).", ex.GetType().Name);
            return false;
        }
    }
}
