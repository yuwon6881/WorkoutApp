# Deployment and recovery

Workout uses an independent Neon PostgreSQL database, a Vercel PWA, and a Cloud Run API in
Singapore. The FinancialApp and NutritionApp services and databases are independent of this one.

## Provisioned resources

| Resource | Value |
| --- | --- |
| Neon project | `workout` (`aged-haze-27826198`), `aws-ap-southeast-1` |
| Neon database | `workout`, role `neondb_owner`, branch `br-little-silence-b3ar6gwa` |
| Secret (connection) | `workout-neon-database` (Google Secret Manager, version 1) |
| Secret (OpenAI key) | `financialapp-openai-api-key` — shared with the sibling apps, not duplicated |
| GCP project | `project-7eb1aec8-8636-4c86-b2a` |
| Cloud Run service | `workout-api`, `asia-southeast1` |
| Service account | `workout-api@project-7eb1aec8-8636-4c86-b2a.iam.gserviceaccount.com` |
| API URL | `https://workout-api-i47taxhzba-as.a.run.app` |
| Image | `asia-southeast1-docker.pkg.dev/<project>/cloud-run-source-deploy/workout-api` |

Cloud Run runs with 1 CPU, 512 MiB, a 180 second timeout, concurrency 20, and minimum 0 /
maximum 1 instances, matching the sibling services.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`.
Neon URLs are normalised with verified TLS, required channel binding, and a maximum local pool
size of 10. Runtime uses the `-pooler` hostname; migrations use its direct counterpart, which
`ConnectionSettings.Direct` derives. No secret belongs in Vite variables or source control.

Migrations are applied before deployment and `Database__MigrateOnStartup` stays `false`:

```powershell
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:ConnectionStrings__Database = (neon connection-string --project-id aged-haze-27826198 --database-name workout --role-name neondb_owner --pooled)
dotnet run --project api\Workout.Api.csproj -- --migrate-only
```

## Exercise catalog

The catalog ships empty and is the only data users cannot create. Load it with the seed command,
which is keyed by stable slug, so re-running the same file updates rows in place instead of
duplicating them. Exercises the file omits are left untouched unless `--deactivate-missing` is
supplied. The whole file is applied in one transaction or not at all.

```powershell
dotnet run --project api\Workout.Api.csproj -- --seed-exercises=path\to\exercises.json
```

Each entry is `{ "slug", "name", "muscle", "equipment", "cue", "aliases": [] }`. Aliases are
matched case- and punctuation-insensitively, and are what lets an AI import resolve a written
exercise name to a catalog row. `web/tests/fixtures/exercises.json` is a three-row example.

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
production Vercel origin. Database migrations remain an explicit pre-deployment operation; the
runtime keeps `Database__MigrateOnStartup=false`.

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
