using System.Text;
using Microsoft.AspNetCore.Http;
using Workout.Api.Domain;
using Workout.Api.Endpoints;
using Xunit;

namespace Workout.Tests;

public sealed class ExternalImportRequestTests
{
    [Fact]
    public async Task Reads_json_without_requiring_a_content_length()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "application/json";
        request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{}"));
        Assert.Equal("{}", await ExternalImportRequest.Read(request, default));
    }

    [Fact]
    public async Task Accepts_a_utf8_byte_order_mark()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "application/json";
        request.Body = new MemoryStream([0xef, 0xbb, 0xbf, (byte)'{', (byte)'}']);
        Assert.Equal("{}", await ExternalImportRequest.Read(request, default));
    }

    [Fact]
    public async Task Rejects_oversized_stream_without_content_length()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "application/json";
        request.Body = new MemoryStream(new byte[ExternalImportRequest.MaxBytes + 1]);
        var error = await Assert.ThrowsAsync<DomainException>(() => ExternalImportRequest.Read(request, default));
        Assert.Equal(413, error.Status);
        Assert.Contains("split", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.True(request.Body.Position <= ExternalImportRequest.MaxBytes + 1);
    }

    [Fact]
    public async Task Rejects_non_json_before_reading_the_body()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "text/plain";
        request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{}"));
        var error = await Assert.ThrowsAsync<DomainException>(() => ExternalImportRequest.Read(request, default));
        Assert.Equal(415, error.Status);
        Assert.Equal(0, request.Body.Position);
    }

    [Fact]
    public async Task Rejects_declared_oversize_without_reading_the_body()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "application/json; charset=utf-8";
        request.ContentLength = ExternalImportRequest.MaxBytes + 1;
        request.Body = new MemoryStream([1]);
        var error = await Assert.ThrowsAsync<DomainException>(() => ExternalImportRequest.Read(request, default));
        Assert.Equal(413, error.Status);
        Assert.Equal(0, request.Body.Position);
    }

    [Fact]
    public async Task Rejects_invalid_utf8()
    {
        var request = new DefaultHttpContext().Request;
        request.ContentType = "application/json";
        request.Body = new MemoryStream([0xff]);
        var error = await Assert.ThrowsAsync<DomainException>(() => ExternalImportRequest.Read(request, default));
        Assert.Contains("UTF-8", error.Message);
        Assert.Contains("save", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}
