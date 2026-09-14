using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;
using Workout.Api.Domain;

namespace Workout.Api.Services;

public interface IIntegrationKms
{
    Task<string> EncryptAsync(string plaintext, CancellationToken ct);
    Task<string> DecryptAsync(string ciphertext, CancellationToken ct);
}

/// Protects peer refresh tokens with Cloud KMS in production. A tagged AES-GCM fallback keeps
/// local development and isolated tests self-contained without making local ciphertext valid in
/// production.
public sealed class IntegrationKmsService(HttpClient http, IConfiguration config, IHostEnvironment environment) : IIntegrationKms
{
    private static readonly byte[] FallbackKey = SHA256.HashData(Encoding.UTF8.GetBytes("WorkoutApp-Integration-Key-2026"));

    private string? KeyName => config["Integrations:KmsKeyName"]?.Trim();

    public async Task<string> EncryptAsync(string plaintext, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(KeyName))
        {
            Validation.Require(environment.IsDevelopment(), "Integrations:KmsKeyName must be configured in production.", 503);
            return LocalEncrypt(plaintext);
        }

        var token = await AccessToken(ct);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://cloudkms.googleapis.com/v1/{KeyName}:encrypt")
        {
            Content = JsonContent(new { plaintext = Convert.ToBase64String(Encoding.UTF8.GetBytes(plaintext)) })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        Validation.Require(response.IsSuccessStatusCode, "Google Cloud KMS encryption failed.", 503);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Validation.Require(document.RootElement.TryGetProperty("ciphertext", out var value) && value.GetString() is { Length: > 0 },
            "Google Cloud KMS returned an unexpected encryption response.", 503);
        return value.GetString()!;
    }

    public async Task<string> DecryptAsync(string ciphertext, CancellationToken ct)
    {
        if (ciphertext.StartsWith("local:", StringComparison.Ordinal))
        {
            Validation.Require(environment.IsDevelopment(), "Local integration ciphertext is not valid in production.", 503);
            return LocalDecrypt(ciphertext);
        }
        Validation.Require(!string.IsNullOrWhiteSpace(KeyName), "Integrations:KmsKeyName must be configured in production.", 503);
        var token = await AccessToken(ct);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://cloudkms.googleapis.com/v1/{KeyName}:decrypt")
        {
            Content = JsonContent(new { ciphertext })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        Validation.Require(response.IsSuccessStatusCode, "Google Cloud KMS decryption failed.", 503);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!document.RootElement.TryGetProperty("plaintext", out var value) || string.IsNullOrWhiteSpace(value.GetString()))
            throw new DomainException("Google Cloud KMS returned an unexpected decryption response.", 503);
        return Encoding.UTF8.GetString(Convert.FromBase64String(value.GetString()!));
    }

    private async Task<string> AccessToken(CancellationToken ct)
    {
        try
        {
            var credential = await GoogleCredential.GetApplicationDefaultAsync(ct);
            var scoped = credential.CreateScoped("https://www.googleapis.com/auth/cloudkms");
            return await scoped.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new DomainException("Google Cloud KMS credentials are unavailable.", 503);
        }
    }

    private static StringContent JsonContent(object body)
        => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static string LocalEncrypt(string plaintext)
    {
        var clear = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        var cipher = new byte[clear.Length];
        using var aes = new AesGcm(FallbackKey, tag.Length);
        aes.Encrypt(nonce, clear, cipher, tag);
        return "local:" + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    private static string LocalDecrypt(string ciphertext)
    {
        var bytes = Convert.FromBase64String(ciphertext["local:".Length..]);
        var nonceLength = AesGcm.NonceByteSizes.MaxSize;
        var tagLength = AesGcm.TagByteSizes.MaxSize;
        Validation.Require(bytes.Length >= nonceLength + tagLength, "Invalid integration ciphertext.");
        var nonce = bytes[..nonceLength];
        var tag = bytes[nonceLength..(nonceLength + tagLength)];
        var cipher = bytes[(nonceLength + tagLength)..];
        var clear = new byte[cipher.Length];
        using var aes = new AesGcm(FallbackKey, tagLength);
        aes.Decrypt(nonce, cipher, tag, clear);
        return Encoding.UTF8.GetString(clear);
    }
}
