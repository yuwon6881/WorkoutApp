# Deployment and recovery

WorkoutApp uses an independent Neon PostgreSQL database, a Vercel PWA, and a Cloud Run API in
Singapore. The FinancialApp and NutritionApp services and databases are independent of this one.

## Provisioned resources

| Resource | Value |
| --- | --- |
| Neon project | `WorkoutApp` (`aged-haze-27826198`), `aws-ap-southeast-1` |
| Neon database | `workout`, role `neondb_owner`, branch `br-little-silence-b3ar6gwa` |
| Secret (connection) | `workout-neon-database` (Google Secret Manager, version 1) |
| Secret (OpenAI key) | `financialapp-openai-api-key` — shared with the sibling apps, not duplicated |
| GCP project | `project-7eb1aec8-8636-4c86-b2a` |
| Cloud Run service | `workout-api`, `asia-southeast1` |
| Cloud Run import worker | `workout-import-worker`, `asia-southeast1` (private, 2 GiB, concurrency 1, scale-to-zero) |
| Import bucket | `workout-imports-396431756440` (private, same region, two-day lifecycle safety net) |
| Import task queue | `workout-imports` (`asia-southeast1`, one chunk per authenticated task) |
| Maintenance scheduler | `workout-import-maintenance` (hourly, authenticated Cloud Run request) |
| Service account | `workout-api@project-7eb1aec8-8636-4c86-b2a.iam.gserviceaccount.com` |
| API URL | `https://workout-api-i47taxhzba-as.a.run.app` |
| Image | `asia-southeast1-docker.pkg.dev/<project>/cloud-run-source-deploy/workout-api` |

The API runs with 1 CPU, 2 GiB, a 3,600 second timeout, HTTP/1.1, concurrency 1, and minimum 0 /
maximum 1 instances. PDF extraction runs in the private `workout-import-worker` service with the
same resource limits, a 1,800 second request timeout, concurrency 1, and minimum 0 / maximum 1
instances. Cloud Tasks delivers one expected extraction chunk per request; the worker keeps no
polling loop in production. An hourly authenticated maintenance request removes expired objects
and recovers dispatches that were not accepted or whose delivery lease expired.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`.
Neon URLs are normalised with verified TLS, required channel binding, and a maximum local pool
size of 10. Runtime uses the `-pooler` hostname; migrations use its direct counterpart, which
`ConnectionSettings.Direct` derives. No secret belongs in Vite variables or source control.

The application database is `workout` in the `WorkoutApp` Neon project. Neon’s provider-created
`neondb` and `postgres` databases are not application targets; `neondb` is empty and is retained
only until the exact cleanup action is separately confirmed.

For production PDF retention, `_IMPORT_BUCKET` is set to `workout-imports-396431756440` in Cloud
Build (or set `ImportStorage__Bucket` on both Cloud Run services). The bucket is private, uniform
access, same-region, and has a two-day object lifecycle safety net. The API and worker use
application default credentials for private object reads, resumable sessions, and deletion.
Without that variable, local development and tests use a private transient filesystem directory
instead. Application cleanup deletes source objects and temporary derivatives as soon as an import
reaches a terminal state; the persisted 24-hour source expiry remains the user-visible retention
contract.

Cloud Tasks dispatch is configured by `_IMPORT_TASK_QUEUE`, `_IMPORT_WORKER_URL`, and
`_IMPORT_WORKER_SERVICE_ACCOUNT` in Cloud Build. Grant the API service account
`roles/cloudtasks.enqueuer` on the queue or project and `roles/run.invoker` on the private
`workout-import-worker`; Cloud Run IAM authenticates each task. The worker's
`/internal/import-tasks` route accepts one idempotent extraction step and receives the expected
chunk in its payload, so duplicates cannot advance another chunk. Keep
`ImportWorker__PollingEnabled=false` in production. The persisted dispatch marker and hourly
maintenance route recover enqueue failures and worker restarts; immediate user-triggered retry
remains available.

Migrations are applied before deployment and `Database__MigrateOnStartup` stays `false`:

```powershell
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:ConnectionStrings__Database = (neon connection-string --project-id aged-haze-27826198 --database-name workout --role-name neondb_owner --pooled)
dotnet run --project api\Workout.Api.csproj -- --migrate-only
```

## Exercise catalog

The schema ships with an empty catalog and it is the only data users cannot create, edit, or
delete. The checked-in `deploy\exercises.json` contains the 263 default movements. Load it with
the seed command, which is keyed by stable slug, so re-running the same file updates rows in place
instead of duplicating them. Exercises the file omits are left untouched unless
`--deactivate-missing` is supplied. The whole file is applied in one transaction or not at all.

```powershell
$seed = (Resolve-Path deploy\exercises.json).Path
dotnet run --project api\Workout.Api.csproj -- --seed-exercises=$seed
```

Each entry is `{ "slug", "name", "muscle", "equipment", "cue", "aliases": [] }`. Aliases are
matched case- and punctuation-insensitively, and are what lets an AI import resolve a written
exercise name to a catalog row. The default file keeps cues empty because the supplied list did not
include coaching text; equipment labels are only filled when the name makes them unambiguous.
`web/tests/fixtures/exercises.json` remains a three-row test example.

## API

Build and deploy with Cloud Build. `_PUBLIC_ORIGIN` must be the exact Vercel production HTTPS
origin without a trailing slash: it is what the session cookie and the CSRF origin check compare
against, so a wrong value makes every mutation fail with 403.

```powershell
gcloud builds submit --config cloudbuild.yaml --region=asia-southeast1 --substitutions=_PUBLIC_ORIGIN=https://<vercel-production-host> .
```

`cloudbuild.image.yaml` builds and pushes the image without deploying, for when the origin is not
yet known.

## Vercel

Deploy the `web` directory as a Vite project. `web/vercel.json` proxies `/api/*` and `/health` to
Cloud Run ahead of the filesystem handler, so requests and the `HttpOnly` cookie stay first-party
on the PWA origin and iPhone third-party cookie rules never apply. Unknown asset URLs return 404
rather than the SPA document, and no authenticated API response is cached.

The project's **Root Directory must be set to `web`**, since the repository root now holds the
API. Set the exact Cloud Run origin in `web/vercel.json` before deploying.

## Automatic deployment

The private GitHub repository `yuwon6881/WorkoutApp` is connected to the Vercel `workout` project.
Vercel builds from the `web` root and promotes `master` pushes to the production domain
`https://workout-one-mocha.vercel.app`.

Cloud Build trigger `deploy-workout-api-master` watches the same repository's `master` branch.
It runs `cloudbuild.yaml`, builds and publishes the API image, and deploys Cloud Run with the
production Vercel origin. Its included-file filter is limited to `api/**`, Docker/deployment files,
and `deploy/**`, so frontend-only commits do not run migrations or catalog jobs. Database
migrations remain an explicit pre-deployment operation; the runtime keeps
`Database__MigrateOnStartup=false`.

## Verification after a deploy

```powershell
curl https://<origin>/health                 # 200 {"status":"ok"}
curl https://<origin>/api/auth/status        # 200 {"registrationOpen":true} until two accounts exist
curl https://<origin>/api/bootstrap          # 401 without a session
curl -X POST https://<origin>/api/auth/login # 403 without the app's origin and X-Workout-Request header
```

## Backup

An authenticated JSON export is a readable copy for the user, not a disaster-recovery backup and
not a restore format. Use `pg_dump --format=custom --no-owner` against the direct Neon endpoint
with credentials injected securely, store the result outside Neon, and restore into an isolated
empty database with `pg_restore --no-owner` before trusting it. Neon time-travel retention is
finite and does not replace these backups.
