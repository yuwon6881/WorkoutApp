using Microsoft.AspNetCore.Http;
using Workout.Api.Services;
using Xunit;

namespace Workout.Tests;

public sealed class WatchAuthenticationTests
{
    [Theory]
    [InlineData("GET", "/api/watch/active", true)]
    [InlineData("GET", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40", true)]
    [InlineData("PATCH", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40/sets/61f04706-0064-41c2-8ffc-32a44fbcab9c", true)]
    [InlineData("POST", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40/pause", true)]
    [InlineData("POST", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40/resume", true)]
    [InlineData("POST", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40/finish", true)]
    [InlineData("POST", "/api/watch/session/revoke", true)]
    [InlineData("GET", "/api/watch/devices", false)]
    [InlineData("POST", "/api/watch/pairing/approve", false)]
    [InlineData("DELETE", "/api/watch/devices/6e9d4551-5a3d-4d04-9f86-39f487c73c40", false)]
    [InlineData("POST", "/api/watch/workouts/6e9d4551-5a3d-4d04-9f86-39f487c73c40/discard", false)]
    [InlineData("GET", "/api/workouts/active", false)]
    public void Device_sessions_are_limited_to_active_workout_routes(string method, string path, bool expected)
    {
        var request = new DefaultHttpContext().Request;
        request.Method = method;
        request.Path = path;

        Assert.Equal(expected, WatchAuthentication.CanUseDeviceSession(request));
    }

    [Theory]
    [InlineData("POST", "/api/watch/pairing/start", true)]
    [InlineData("POST", "/api/watch/pairing/status", true)]
    [InlineData("GET", "/api/watch/pairing/status", false)]
    [InlineData("POST", "/api/watch/pairing/approve", false)]
    public void Only_pair_start_and_status_use_the_pairing_bootstrap(string method, string path, bool expected)
    {
        var request = new DefaultHttpContext().Request;
        request.Method = method;
        request.Path = path;

        Assert.Equal(expected, WatchAuthentication.IsPairingBootstrap(request));
    }
}
