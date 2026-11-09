using Workout.Api.Domain;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class ImportLegacyDraftCompatibilityTests
{
    private const string LegacyDraft = """
    {"programName":"Legacy program","sourceWeekDays":7,"workouts":[
      {"lineId":"11111111-1111-1111-1111-111111111111","week":1,"name":"Upper","focus":null,"notes":null,
       "block":"Base","phase":"Build","phaseWeek":1,"isRestDay":false,"sourcePage":4,"exercises":[
        {"lineId":"22222222-2222-2222-2222-222222222222","sourceName":"Bench press","exerciseId":null,
         "notes":"Controlled","sequenceGroup":"A1","substitutions":["Dumbbell press"],"sourcePage":4,
         "sets":[{"repMin":8,"repMax":10,"targetRpe":8,"restSeconds":90,"tempo":"3-0-1",
                   "loadText":null,"notes":null,"rir":"2","warmup":false,"sourcePage":4}]}]}]}
    """;

    [Fact]
    public void Legacy_pdf_draft_round_trips_and_normalizes_without_losing_fields()
    {
        var loaded = Json.Read<ImportDraft>(LegacyDraft);
        var normalized = ImportValidation.NormalizeDraft(loaded);
        var roundTrip = Json.Read<ImportDraft>(Json.Write(normalized));
        var day = Assert.Single(roundTrip.Workouts);
        var exercise = Assert.Single(day.Exercises);
        var set = Assert.Single(exercise.Sets);
        Assert.Equal("Legacy program", roundTrip.ProgramName);
        Assert.Equal(7, roundTrip.SourceWeekDays);
        Assert.Equal(("Base", "Build", 1, 4), (day.Block, day.Phase, day.PhaseWeek, day.SourcePage));
        Assert.Equal(new ImportSourceReference("pdfPage", Page: 4), day.SourceReference);
        Assert.Equal(day.SourceReference, exercise.SourceReference);
        Assert.Equal(day.SourceReference, set.SourceReference);
        Assert.Equal(("Bench press", "A1", 4), (exercise.SourceName, exercise.SequenceGroup, exercise.SourcePage));
        Assert.Equal("Dumbbell press", Assert.Single(exercise.Substitutions!));
        Assert.Equal((8, 10, 8.0, 90, "3-0-1", "2", 4),
            (set.RepMin, set.RepMax, set.TargetRpe, set.RestSeconds, set.Tempo, set.Rir, set.SourcePage));
    }

    [Theory]
    [InlineData("sheetCell", "Sheet 1", "A1:B3", null)]
    [InlineData("text", null, null, "Introduction, paragraph 2")]
    [InlineData("none", null, null, null)]
    public void New_source_references_and_uncertainty_survive_draft_round_trip(string kind, string? sheet, string? cell, string? text)
    {
        var reference = new ImportSourceReference(kind, Sheet: sheet, Cell: cell, Text: text);
        ImportSourceReference.Validate(reference, null);
        var uncertainty = new ImportUncertainty(true, "The set count is unclear");
        ImportUncertainty.Validate(uncertainty);
        var draft = Json.Read<ImportDraft>(LegacyDraft);
        var day = draft.Workouts.Single();
        var exercise = day.Exercises.Single();
        var set = exercise.Sets.Single();
        var updated = draft with { Workouts = [day with {
            SourcePage = null, SourceReference = reference,
            Exercises = [exercise with { SourcePage = null, SourceReference = reference, Uncertainty = uncertainty,
                Sets = [set with { SourcePage = null, SourceReference = reference, Uncertainty = uncertainty }] }]
        }] };
        var result = ImportValidation.NormalizeDraft(Json.Read<ImportDraft>(Json.Write(updated)));
        Assert.Equal(reference, result.Workouts.Single().SourceReference);
        Assert.Equal(uncertainty, result.Workouts.Single().Exercises.Single().Uncertainty);
        Assert.Equal(reference, result.Workouts.Single().Exercises.Single().Sets.Single().SourceReference);
        Assert.Equal(uncertainty, result.Workouts.Single().Exercises.Single().Sets.Single().Uncertainty);
        var alternative = new ImportAlternative("a", "Option A", 1) { Uncertainty = uncertainty };
        Assert.Equal(uncertainty, Json.Read<ImportAlternative>(Json.Write(alternative)).Uncertainty);
    }

    [Fact]
    public void Invalid_or_conflicting_source_references_are_rejected()
    {
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("sheetCell", Sheet: "Sheet 1"), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("pdfPage", Page: 5), 4));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("unknown"), null));
        Assert.Throws<DomainException>(() => ImportUncertainty.Validate(new ImportUncertainty(true, new string('x', 201))));
    }

    [Theory]
    [InlineData("not a cell")]
    [InlineData("A0")]
    [InlineData("XFE1")]
    [InlineData("A1048577")]
    [InlineData("A1:")]
    public void Invalid_spreadsheet_cells_are_rejected(string cell)
    {
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("sheetCell", Sheet: "Sheet1", Cell: cell), null));
    }

    [Fact]
    public void Reference_limits_and_sheet_names_are_validated()
    {
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("unknown"), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("sheetCell", Sheet: "  ", Cell: "A1"), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("sheetCell", Sheet: "Bad/Name", Cell: "A1"), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("text", Text: new string('x', 201)), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("pdfPage", Page: 0), null));
        Assert.Throws<DomainException>(() => ImportSourceReference.Validate(new ImportSourceReference("pdfPage", Page: 1001), null));
        ImportSourceReference.Validate(new ImportSourceReference("sheetCell", Sheet: "Sheet 1", Cell: "$A$1:XFD1048576"), null);
    }

    [Fact]
    public void Legacy_saved_program_prescription_remains_readable()
    {
        const string json = """{"repMin":5,"repMax":5,"targetRpe":8,"restSeconds":120,"tempo":null,"loadText":null,"notes":null,"sourcePage":12}""";
        var set = Json.Read<SetPrescription>(json);
        var roundTrip = Json.Read<SetPrescription>(Json.Write(set));
        Assert.Equal(5, roundTrip.RepMin);
        Assert.Equal(12, roundTrip.SourcePage);
        Assert.Equal("extracted", roundTrip.RepsSource);
    }
}
