namespace Workout.Api.Services;

/// How much of a document one read is asked for.
///
/// A section is read in a single model answer, and an answer has a ceiling. A block of a real
/// training program — five sessions a week for six weeks, one page per session — is thirty days of
/// dense tables, far more than one answer holds, so the read stops partway through its pages and
/// returns a shorter program that looks complete. Nothing is refused and nothing is retried,
/// because the answer it gave was valid; the weeks it never reached are simply missing.
///
/// The outline is asked for small sections, and whatever it returns is divided here so that no
/// read is ever asked for more than it can answer. Pages are the axis, because they are the one
/// thing the outline states exactly: the day count it reports is an estimate made from page
/// previews, and it decides how many pieces a section becomes rather than where they are cut.
internal static class ImportSections
{
    /// The days one read is asked for. Each day is a table of exercises, sets, rests and notes,
    /// and the answer also has to carry the model's own reasoning within the same ceiling.
    public const int TargetSectionDays = 8;

    /// The pages one read is asked for, whatever the outline estimated they hold. The day count is
    /// an estimate made from page previews and is regularly wrong in both directions, so a section
    /// that claims to be small is still divided when it covers a stretch of the document too long
    /// to answer in one go.
    public const int MaxSectionPages = 12;

    /// A divided outline holds more sections than the model drew, so the ceiling on how many an
    /// import may hold is its own, well above what any document has needed.
    public const int MaxSections = 60;

    public static List<ImportChunk> Divide(IEnumerable<ImportChunk> chunks)
        => chunks.SelectMany(DivideOne).ToList();

    private static IEnumerable<ImportChunk> DivideOne(ImportChunk chunk)
    {
        var pages = chunk.PageTo - chunk.PageFrom + 1;
        // A section can be cut no finer than one page, so a dense page stays whole and is read as
        // it is rather than being split into something a page boundary cannot honour.
        var pieces = Math.Min(pages, Math.Max(
            (chunk.DayCount + TargetSectionDays - 1) / TargetSectionDays,
            (pages + MaxSectionPages - 1) / MaxSectionPages));
        if (pieces <= 1)
        {
            yield return chunk;
            yield break;
        }
        var page = chunk.PageFrom;
        for (var index = 0; index < pieces; index++)
        {
            var size = Apportion(pages, pieces, index);
            var last = page + size - 1;
            yield return chunk with
            {
                // The weeks stay whole on every piece: which of them a given page documents is
                // exactly what the outline could not say, and a day is checked against the
                // section's weeks rather than against a guess made here.
                Label = ImportValidation.SuffixedLabel(chunk.Label, $"pages {page}-{last}"),
                PageFrom = page,
                PageTo = last,
                // Every piece covers pages, so none of them can honestly claim to hold no days.
                DayCount = Math.Max(1, Apportion(chunk.DayCount, pieces, index))
            };
            page = last + 1;
        }
    }

    /// One piece's share of a total, distributed so the pieces still add up to what was divided.
    private static int Apportion(int total, int pieces, int index)
        => total / pieces + (index < total % pieces ? 1 : 0);
}
