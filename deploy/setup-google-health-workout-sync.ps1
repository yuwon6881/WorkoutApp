[CmdletBinding()]
param(
    [string]$ProjectId = (gcloud config get-value project 2>$null),
    [string]$Region = 'asia-southeast1',
    [string]$JobName = 'workout-google-health-workout-sync',
    [string]$ApiOrigin = '',
    [string]$SchedulerToken = $env:WORKOUT_MAINTENANCE_SECRET
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectId) -or $ProjectId -eq '(unset)') {
    throw 'Provide -ProjectId or configure a gcloud project.'
}
if ([string]::IsNullOrWhiteSpace($ApiOrigin)) {
    throw 'Provide -ApiOrigin with the public Cloud Run API origin.'
}
if ([string]::IsNullOrWhiteSpace($SchedulerToken)) {
    throw 'Provide -SchedulerToken from Secret Manager or set WORKOUT_MAINTENANCE_SECRET; do not store it in source control.'
}

$uri = "$($ApiOrigin.TrimEnd('/'))/internal/google-health-workout-sync"
$locationArgs = @('--project', $ProjectId, '--location', $Region)
$targetArgs = @(
    '--schedule', '37 * * * *',
    '--time-zone', 'UTC',
    '--uri', $uri,
    '--http-method', 'POST',
    '--headers', "X-Workout-Maintenance-Secret=$SchedulerToken",
    '--message-body', '{}',
    '--attempt-deadline', '60s',
    '--quiet'
)

$existingName = & gcloud scheduler jobs describe $JobName @locationArgs '--format=value(name)' 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingName)) {
    & gcloud scheduler jobs update http $JobName @locationArgs @targetArgs
} else {
    & gcloud scheduler jobs create http $JobName @locationArgs @targetArgs
}

if ($LASTEXITCODE -ne 0) {
    throw "Cloud Scheduler could not configure $JobName."
}

Write-Output "Configured $JobName in $Region to POST hourly at minute 37."
