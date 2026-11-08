using Workout.Api.Domain;
using Workout.Api.Services;
using System.Text.Json;
using Xunit;

namespace Workout.Tests;

public sealed class ExternalImportEnvelopeTests
{
    [Fact]
    public void Reads_a_versioned_document_without_interpreting_its_contents()
    {
        var input = """{"version":1,"program":{"name":"Strength","days":[]}}""";
        using var document = ExternalImportEnvelope.Parse(input);
        Assert.Equal("Strength", document.RootElement.GetProperty("program").GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("{\"version\":1,")]
    [InlineData("[]")]
    [InlineData("{\"version\":2,\"program\":{}}")]
    [InlineData("{\"version\":1}")]
    [InlineData("{\"version\":1,\"version\":1,\"program\":{}}")]
    [InlineData("{\"version\":1,\"program\":{\"name\":\"A\",\"name\":\"B\"}}")]
    public void Rejects_invalid_or_ambiguous_documents(string input)
    {
        Assert.Throws<DomainException>(() => ExternalImportEnvelope.Parse(input));
    }

    [Theory]
    [InlineData("", "empty")]
    [InlineData("   \n", "empty")]
    [InlineData("```json\n{\"version\":1}\n```", "Markdown code fence")]
    [InlineData("Here is your file: {\"version\":1}", "does not start with {")]
    public void Explains_text_that_is_not_json_without_echoing_it(string input, string expected)
    {
        var error = Assert.Throws<DomainException>(() => ExternalImportEnvelope.Parse(input));
        Assert.Contains(expected, error.Message);
        Assert.DoesNotContain("Here is your file", error.Message);
    }

    [Fact]
    public void Reports_where_a_truncated_file_breaks()
    {
        var error = Assert.Throws<DomainException>(() => ExternalImportEnvelope.Parse("{\n  \"version\": 1,\n  \"program\": {\"name\": \"A\","));
        Assert.Matches(@"line \d+, column \d+", error.Message);
        Assert.Contains("cut off", error.Message);
    }

    [Fact]
    public void Rejects_an_oversized_document()
    {
        Assert.Throws<DomainException>(() => ExternalImportEnvelope.Parse(new string(' ', ExternalImportEnvelope.MaxBytes + 1)));
    }

    [Theory]
    [InlineData("{\"version\":1,", "complete")]
    [InlineData("{\"version\":2,\"program\":{}}", "version 1")]
    public void Errors_explain_how_to_correct_the_file(string input, string instruction)
    {
        var error = Assert.Throws<DomainException>(() => ExternalImportEnvelope.Parse(input));
        Assert.Contains(instruction, error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Structural_error_collection_is_bounded()
    {
        var fields = string.Join(',', Enumerable.Range(0, 150).Select(index => $"\"extra{index}\":true"));
        using var document = JsonDocument.Parse($"{{\"version\":1,\"program\":{{\"name\":\"P\",\"days\":[],{fields}}}}}");
        var error = Assert.Throws<DomainException>(() => ExternalImportSchema.Validate(document.RootElement));
        Assert.Equal(100, Assert.IsType<ExternalImportPath.FieldError[]>(error.Data["errors"]).Length);
    }
}
