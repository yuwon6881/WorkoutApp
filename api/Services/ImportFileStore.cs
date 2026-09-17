using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Google.Cloud.Storage.V1;
using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Source PDFs are kept outside the database and are addressed by an opaque per-user key. The
/// default store uses the instance's private temporary directory; deployments can point the root
/// at a private mounted object-store gateway without changing the import contract.
public interface IImportFileStore
{
    Task<string> Save(Guid userId, Guid importId, byte[] bytes, CancellationToken ct);
    Task<string> StartUpload(Guid userId, Guid uploadId, long expectedBytes, CancellationToken ct);
    /// Returns the total number of bytes the store has actually committed. Storage is the
    /// authority on that number: a resumable backend may commit less than was sent, and assuming
    /// otherwise drifts the caller past the real offset until every later chunk is rejected.
    Task<long> Append(string key, long offset, byte[] bytes, long totalBytes, CancellationToken ct);
    Task<byte[]> Read(string key, CancellationToken ct);
    Task Delete(string? key, CancellationToken ct);
}

public sealed class TransientImportFileStore(IConfiguration config) : IImportFileStore
{
    private readonly string root = Path.GetFullPath(config["ImportStorage:Directory"]?.Trim() ??
        Path.Combine(Path.GetTempPath(), "workout-imports"));

    public async Task<string> Save(Guid userId, Guid importId, byte[] bytes, CancellationToken ct)
    {
        var relative = Path.Combine(userId.ToString("N"), importId.ToString("N") + ".pdf");
        var full = Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, bytes, ct);
        return relative;
    }

    public Task<string> StartUpload(Guid userId, Guid uploadId, long expectedBytes, CancellationToken ct)
    {
        var relative = Path.Combine(userId.ToString("N"), "uploads", uploadId.ToString("N") + ".part");
        var full = Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        using (File.Create(full)) { }
        return Task.FromResult(relative);
    }

    public async Task<long> Append(string key, long offset, byte[] bytes, long totalBytes, CancellationToken ct)
    {
        var full = Resolve(key);
        Validation.Require(File.Exists(full), "That upload session has expired. Start the upload again.", 410);
        await using var stream = new FileStream(full, FileMode.Open, FileAccess.ReadWrite, FileShare.Read, 128 * 1024, useAsync: true);
        Validation.Require(stream.Length == offset, "The upload offset is stale; refresh the upload and retry the next chunk.", 409);
        stream.Seek(offset, SeekOrigin.Begin);
        await stream.WriteAsync(bytes, ct);
        await stream.FlushAsync(ct);
        return stream.Length;
    }

    public async Task<byte[]> Read(string key, CancellationToken ct)
    {
        var full = Resolve(key);
        // A resumable part and an import source fail for different reasons and need different
        // instructions: one asks for the upload to be started again, the other for the PDF.
        if (!File.Exists(full)) throw new DomainException(
            full.EndsWith(".part", StringComparison.OrdinalIgnoreCase)
                ? "That upload did not finish storing. Start the upload again."
                : "The temporary PDF has expired. Upload it again.", 410);
        return await File.ReadAllBytesAsync(full, ct);
    }

    public Task Delete(string? key, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(key)) return Task.CompletedTask;
        var full = Resolve(key);
        if (File.Exists(full)) File.Delete(full);
        return Task.CompletedTask;
    }

    private string Resolve(string key)
    {
        var relative = key.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(root, relative));
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!full.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
            throw new DomainException("The temporary PDF key is invalid.", 400);
        return full;
    }
}

/// Google Cloud Storage implementation used when ImportStorage:Bucket is configured. The bucket
/// should remain private; the API only ever receives an opaque resumable session URI and never
/// exposes a public object URL. The filesystem implementation remains a local/test fallback.
public sealed class GcsImportFileStore(IConfiguration config, HttpClient http) : IImportFileStore
{
    private const string ObjectPrefix = "gcs:";
    private const string SessionPrefix = "gcs-session:";
    private readonly string bucket = config["ImportStorage:Bucket"]!.Trim();
    private readonly Lazy<Task<StorageClient>> client = new(() => StorageClient.CreateAsync());

    public async Task<string> Save(Guid userId, Guid importId, byte[] bytes, CancellationToken ct)
    {
        var name = ObjectName(userId, importId);
        await using var stream = new MemoryStream(bytes, writable: false);
        // The name is derived from the owning user and import, so only this import can write it.
        // Overwriting is deliberate: re-uploading the same PDF is how a lost source is restored,
        // and a generation precondition would turn that recovery into a permanent failure.
        await (await client.Value).UploadObjectAsync(bucket, name, "application/pdf", stream, null, ct);
        return ObjectPrefix + name;
    }

    public async Task<string> StartUpload(Guid userId, Guid uploadId, long expectedBytes, CancellationToken ct)
    {
        var name = $"uploads/{userId:N}/{uploadId:N}.pdf";
        var session = await (await client.Value).InitiateUploadSessionAsync(bucket, name, "application/pdf", expectedBytes,
            new UploadObjectOptions { IfGenerationMatch = 0 }, ct);
        return SessionPrefix + Encode(session.ToString()) + "|" + name;
    }

    public async Task<long> Append(string key, long offset, byte[] bytes, long totalBytes, CancellationToken ct)
    {
        var (session, _) = ParseSession(key);
        using var request = new HttpRequestMessage(HttpMethod.Put, session);
        request.Headers.TryAddWithoutValidation("Content-Range", $"bytes {offset}-{offset + bytes.Length - 1}/{totalBytes}");
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        // A success here is the finalising write: the object now exists and holds every byte.
        if (response.IsSuccessStatusCode) return totalBytes;
        // 308 "resume incomplete" is the normal answer to every other chunk, and its Range header
        // is the only trustworthy account of what was stored. Google may commit less than was
        // sent, so assuming the whole chunk landed walks the next Content-Range past the real
        // offset and every later chunk is rejected — which is what stalled large uploads.
        Validation.Require((int)response.StatusCode == 308, "The cloud upload rejected this chunk. Retry the same chunk.", 503);
        return Committed(response, offset);
    }

    /// Reads Google's `Range: bytes=0-<last>` acknowledgement. An absent header means nothing has
    /// been committed yet, which is a legitimate answer to a chunk it chose not to keep.
    private static long Committed(HttpResponseMessage response, long offset)
    {
        var range = response.Headers.TryGetValues("Range", out var values) ? values.FirstOrDefault() : null;
        if (string.IsNullOrWhiteSpace(range)) return 0;
        var dash = range.LastIndexOf('-');
        if (dash < 0 || !long.TryParse(range[(dash + 1)..], out var last)) return offset;
        return last + 1;
    }

    public async Task<byte[]> Read(string key, CancellationToken ct)
    {
        var (session, objectName) = ParseObject(key);
        await using var stream = new MemoryStream();
        try { await (await client.Value).DownloadObjectAsync(bucket, objectName, stream, cancellationToken: ct); }
        catch (Google.GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound)
        {
            // A missing resumable part is an unfinished upload, not an expired import source.
            // Saying "the temporary PDF has expired" here sends the user to re-upload a file the
            // importer never actually accepted.
            throw session is null
                ? new DomainException("The temporary PDF has expired. Upload it again.", 410)
                : new DomainException("That upload did not finish storing. Start the upload again.", 410);
        }
        return stream.ToArray();
    }

    public async Task Delete(string? key, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        var (_, objectName) = ParseObject(key);
        try { await (await client.Value).DeleteObjectAsync(bucket, objectName, cancellationToken: ct); }
        catch (Google.GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.NotFound) { }
    }

    private static string ObjectName(Guid userId, Guid importId) => $"imports/{userId:N}/{importId:N}.pdf";

    private static (Uri Session, string ObjectName) ParseSession(string key)
    {
        Validation.Require(key.StartsWith(SessionPrefix, StringComparison.Ordinal), "The cloud upload session is invalid.", 400);
        var parts = key[SessionPrefix.Length..].Split('|', 2);
        Validation.Require(parts.Length == 2, "The cloud upload session is invalid.", 400);
        Validation.Require(Uri.TryCreate(Decode(parts[0]), UriKind.Absolute, out var uri), "The cloud upload session is invalid.", 400);
        return (uri!, parts[1]);
    }

    private static (Uri? Session, string ObjectName) ParseObject(string key)
    {
        if (key.StartsWith(ObjectPrefix, StringComparison.Ordinal)) return (null, key[ObjectPrefix.Length..]);
        if (key.StartsWith(SessionPrefix, StringComparison.Ordinal)) { var parsed = ParseSession(key); return (parsed.Session, parsed.ObjectName); }
        throw new DomainException("The temporary PDF key is invalid.", 400);
    }

    private static string Encode(string value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    private static string Decode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        return Encoding.UTF8.GetString(Convert.FromBase64String(padded));
    }
}
