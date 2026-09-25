using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Workout.Api.Data;

/// SQLite stores timestamps as text without a zone, so EF reads them back with an unspecified
/// kind and they serialize without the "Z" PostgreSQL's timestamptz produces. Browsers then read
/// UTC as local time and every timer is off by the machine's offset. The app writes UTC only, so
/// marking the values as UTC on read makes the local database answer the way production does.
internal static class SqliteUtcDateTimes
{
    public static void Apply(ModelConfigurationBuilder conventions)
    {
        conventions.Properties<DateTime>().HaveConversion<UtcConverter>();
        conventions.Properties<DateTime?>().HaveConversion<NullableUtcConverter>();
    }

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        value => value,
        value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private sealed class NullableUtcConverter() : ValueConverter<DateTime?, DateTime?>(
        value => value,
        value => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : value);
}
