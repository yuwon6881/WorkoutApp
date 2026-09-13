# Completes the deployment once someone has authenticated the Vercel CLI.
#
# Everything else is already provisioned: the Neon project and schema, the Secret Manager entry,
# the service account, the container image, and the Cloud Run service. The only thing missing is
# the public origin, because the API's cookie and CSRF checks compare against the exact origin the
# browser uses, and that origin is only known once the frontend has been deployed.
#
#   1. vercel login          (interactive, one time)
#   2. .\deploy\finish-deploy.ps1
#
# Re-running it is safe.

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$web = Join-Path $repo 'web'
$project = 'project-7eb1aec8-8636-4c86-b2a'
$region = 'asia-southeast1'
$service = 'workout-api'

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }

Step 'Checking the Vercel CLI is authenticated'
$who = (& vercel whoami 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $who -match 'Log in|credentials') {
  throw "Vercel CLI is not authenticated. Run 'vercel login' first, then re-run this script."
}
Write-Host "signed in as $who"

Step 'Deploying the PWA to production'
Push-Location $web
try {
  $output = & vercel --prod --yes 2>&1 | Out-String
  Write-Host $output
  $origin = ([regex]::Matches($output, 'https://[a-z0-9.-]+\.vercel\.app') | Select-Object -Last 1).Value
} finally { Pop-Location }

if (-not $origin) { throw 'Could not determine the production URL from the Vercel output.' }

# Vercel's per-deployment URL changes every time; the stable production alias is what the browser
# uses and therefore what the API must trust.
Step "Resolving the stable production alias"
Push-Location $web
try {
  $inspect = & vercel inspect $origin 2>&1 | Out-String
  $aliases = [regex]::Matches($inspect, 'https://[a-z0-9.-]+\.vercel\.app') | ForEach-Object { $_.Value } | Sort-Object Length
  if ($aliases) { $origin = $aliases[0] }
} finally { Pop-Location }
Write-Host "production origin: $origin"

Step 'Pointing the API at that origin'
& gcloud run services update $service --region=$region --project=$project --update-env-vars="PublicOrigin=$origin" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to update the Cloud Run service.' }

Step 'Verifying'
$checks = @(
  @{ path = '/health'; expect = 200 },
  @{ path = '/api/auth/status'; expect = 200 },
  @{ path = '/api/bootstrap'; expect = 401 }
)
foreach ($check in $checks) {
  try { $code = (Invoke-WebRequest -Uri "$origin$($check.path)" -UseBasicParsing -TimeoutSec 60).StatusCode }
  catch { $code = [int]$_.Exception.Response.StatusCode }
  $ok = if ($code -eq $check.expect) { 'ok' } else { "UNEXPECTED (wanted $($check.expect))" }
  "{0,-22} {1}  {2}" -f $check.path, $code, $ok
}

Write-Host "`nDone. Open $origin and register the first account." -ForegroundColor Green
Write-Host "The exercise library is still empty; load it with the seed command in deploy/README.md."
