using Npgsql;

namespace Workout.Api.Data;
public static class ConnectionSettings
{
    public static string Normalize(string value)
    {
        if(!value.StartsWith("postgresql://",StringComparison.OrdinalIgnoreCase)&&!value.StartsWith("postgres://",StringComparison.OrdinalIgnoreCase))return value;
        var uri=new Uri(value);var parts=uri.UserInfo.Split(':',2);
        var builder=new NpgsqlConnectionStringBuilder
        {
            Host=uri.Host,Port=uri.IsDefaultPort?5432:uri.Port,Database=Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username=Uri.UnescapeDataString(parts[0]),Password=parts.Length>1?Uri.UnescapeDataString(parts[1]):"",
            SslMode=SslMode.VerifyFull,ChannelBinding=ChannelBinding.Require,MaxPoolSize=10,MinPoolSize=0,ConnectionIdleLifetime=60,Timeout=30,CommandTimeout=30
        };
        return builder.ConnectionString;
    }
    /// Neon pooled endpoints cannot run schema migrations; the direct host can.
    public static string Direct(string value)
    {
        var builder=new NpgsqlConnectionStringBuilder(Normalize(value));
        if(builder.Host?.EndsWith(".neon.tech",StringComparison.OrdinalIgnoreCase)==true)builder.Host=builder.Host.Replace("-pooler.",".",StringComparison.Ordinal);
        return builder.ConnectionString;
    }
}
