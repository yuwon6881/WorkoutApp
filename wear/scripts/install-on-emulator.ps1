[CmdletBinding()]
param(
    [string]$WorkoutApiOrigin = "http://10.0.2.2:5183",
    [string]$Serial
)

$ErrorActionPreference = "Stop"

$androidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $androidSdk) {
    throw "Set ANDROID_HOME or ANDROID_SDK_ROOT to your Android SDK folder."
}

$adb = Join-Path $androidSdk "platform-tools/adb.exe"
if (-not (Test-Path -LiteralPath $adb)) {
    throw "Android platform-tools were not found at $adb."
}

$apiUri = $null
if (-not [Uri]::TryCreate($WorkoutApiOrigin, [UriKind]::Absolute, [ref]$apiUri) -or
    $apiUri.Scheme -notin @("http", "https")) {
    throw "WorkoutApiOrigin must be an absolute HTTP or HTTPS URL."
}

if (-not $Serial) {
    $emulators = @(& $adb devices | Where-Object { $_ -match '^emulator-\d+\s+device$' } |
        ForEach-Object { ($_ -split '\s+')[0] })
    if ($emulators.Count -eq 0) {
        throw "Start a Wear OS virtual device in Android Studio Device Manager, then run this script again."
    }
    if ($emulators.Count -gt 1) {
        throw "More than one emulator is connected. Pass -Serial with the Wear OS emulator id (for example emulator-5556)."
    }
    $Serial = $emulators[0]
}

$deviceState = & $adb -s $Serial get-state
if ($LASTEXITCODE -ne 0 -or $deviceState.Trim() -ne "device") {
    throw "Android emulator $Serial is not ready. Start a Wear OS virtual device and try again."
}

$wearRoot = Split-Path -Parent $PSScriptRoot
$gradle = Join-Path $wearRoot "gradlew.bat"
$apk = Join-Path $wearRoot "app/build/outputs/apk/debug/app-debug.apk"

Push-Location $wearRoot
try {
    & $gradle ":app:assembleDebug" "-PworkoutApiOrigin=$WorkoutApiOrigin"
    if ($LASTEXITCODE -ne 0) {
        throw "Wear OS debug build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

& $adb -s $Serial install -r $apk
if ($LASTEXITCODE -ne 0) {
    throw "Could not install the Wear OS app on $Serial. Check that it is a Wear OS virtual device."
}

& $adb -s $Serial shell am start -n "com.workoutapp.wear/.MainActivity"
if ($LASTEXITCODE -ne 0) {
    throw "Could not launch the Wear OS app on $Serial."
}

Write-Host "Installed Workout on $Serial using $WorkoutApiOrigin."
