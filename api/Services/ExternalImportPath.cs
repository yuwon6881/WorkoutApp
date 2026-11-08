using Workout.Api.Domain;

namespace Workout.Api.Services;

/// Locates validation failures in the uploaded file. The location rides on <see cref="DomainException.Data"/>
/// so existing validators can stay unchanged; every key lives here and is read and written only through
/// these members, so a misspelt key is a compile error rather than a silently lost path.
internal static class ExternalImportPath
{
    internal sealed record FieldError(string Path, string Message);

    private const string PathKey = "path";
    private const string ErrorsKey = "errors";
    private const string RelativePathKey = "relativePath";
    private const string RelativeErrorsKey = "relativeErrors";

    /// Where in the file the failure is, or null when no validator located it.
    public static string? PathOf(DomainException error) => error.Data[PathKey] as string;

    /// Every located problem the failure carries, falling back to the single message at its own path.
    public static IReadOnlyList<FieldError> ErrorsOf(DomainException error)
        => error.Data[ErrorsKey] as FieldError[] ?? [new(PathOf(error) ?? "$", error.Message)];

    public static DomainException WithPath(DomainException error, string path)
    {
        error.Data[PathKey] = path;
        return error;
    }

    /// One exception carrying several located problems; its own message and path are the first of them.
    public static DomainException Aggregate(IReadOnlyList<FieldError> errors, int status = 400)
    {
        var failure = new DomainException(errors[0].Message, status);
        failure.Data[PathKey] = errors[0].Path;
        failure.Data[ErrorsKey] = errors.ToArray();
        return failure;
    }

    /// Runs one unit of validation and, if it fails, returns what went wrong instead of throwing, so
    /// independent units can all be reported together.
    public static IReadOnlyList<FieldError> Collect(string path, Action action)
    {
        try { action(); return []; }
        catch (DomainException error)
        {
            return error.Data.Contains(PathKey) ? ErrorsOf(error) : [new(path, error.Message)];
        }
    }

    public static T At<T>(string path, Func<T> action)
    {
        try { return action(); }
        catch (DomainException error)
        {
            if (!error.Data.Contains(PathKey)) error.Data[PathKey] = path + (error.Data[RelativePathKey] as string ?? "");
            if (error.Data[RelativeErrorsKey] is List<FieldError> errors)
                error.Data[ErrorsKey] = errors.Select(item => item with { Path = path + item.Path }).ToArray();
            throw;
        }
    }

    public static void At(string path, Action action) => At(path, () => { action(); return true; });

    public static void Reference(string path, ImportSourceReference? reference)
    {
        At(path, () => {
            try { ImportSourceReference.Validate(reference, null); }
            catch (DomainException)
            {
                throw new DomainException("Correct the source reference: use a valid pdfPage, sheetCell, text locator, or none, with only the fields for that kind.");
            }
        });
    }

    public static async Task AtAsync(string path, Func<Task> action)
    {
        try { await action(); }
        catch (DomainException error)
        {
            if (!error.Data.Contains(PathKey)) error.Data[PathKey] = path;
            throw;
        }
    }

    // Schema validation builds locations relative to the object it is inside; they are made absolute by At.
    public static string? RelativePathOf(DomainException error) => error.Data[RelativePathKey] as string;
    public static List<FieldError>? RelativeErrorsOf(DomainException error) => error.Data[RelativeErrorsKey] as List<FieldError>;

    public static void SetRelative(DomainException error, string path, List<FieldError>? errors = null)
    {
        error.Data[RelativePathKey] = path;
        if (errors is not null) error.Data[RelativeErrorsKey] = errors;
    }

    public static DomainException WithRelativeErrors(string message, List<FieldError> errors)
    {
        var failure = new DomainException(message);
        SetRelative(failure, errors[0].Path, errors);
        return failure;
    }
}
