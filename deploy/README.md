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
| Maintenance scheduler | `workout-import-maintenance` (daily, `X-Workout-Maintenance-Secret`) |
| Secret (maintenance) | `workout-maintenance-secret` (Google Secret Manager) |
| Service account | `workout-api@project-7eb1aec8-8636-4c86-b2a.iam.gserviceaccount.com` |
| Rest-alert task caller | `workout-rest-task@project-7eb1aec8-8636-4c86-b2a.iam.gserviceaccount.com` (must be provisioned before enabling push) |
| API URL | `https://workout-api-i47taxhzba-as.a.run.app` |
| Image | `asia-southeast1-docker.pkg.dev/<project>/cloud-run-source-deploy/workout-api` |

The API runs with 1 CPU, 2 GiB, a 3,600 second timeout, HTTP/1.1, concurrency 4, and minimum 0 /
maximum 1 instances. PDF import needs nothing else: the browser reads the document's text on the
device and posts it gzipped. The extract endpoint starts an in-process background pass and returns
immediately; the browser polls the import row while the runner reads sections and commits them in
outline order. Concurrency is 4 rather than 1 so those two-second polls do not queue behind each
other and behind the account's other calls on the single instance; it is still one container, so
the billing shape is unchanged.

CPU throttling stays on — `--no-cpu-throttling` is deliberately absent. It would keep the
background pass on CPU between polls, but it switches the service to instance-based billing for the
whole lifetime of the instance rather than per request. An import spends almost all of its wall
clock awaiting the model over HTTPS, so the throttled work is only response parsing and the merge
pass, and those already get CPU on each poll. Import latency is governed by `OpenAi:ReasoningEffort`
and `OpenAi:MaxConcurrentChunks`, neither of which costs Cloud Run anything.

Request-based billing scales to zero when idle. A daily maintenance request runs the retention sweep; because the API is reachable
without Cloud Run IAM, `/internal/import-maintenance` exists only when `Maintenance__Secret` is
configured and answers 404 unless the request presents it in `X-Workout-Maintenance-Secret`.

Each import pass claims a five-minute database lease with a fencing token before calling OpenAI.
Successful section responses are committed independently, and a stale process cannot commit after
another lease takes over. The runner is still in-process; move dispatch to the retired Cloud Tasks
worker only after the durable claim path has been staged and measured.

The API emits low-cardinality OpenTelemetry-compatible meters for route requests, database command
kind/duration, and outbound OpenAI, Nutrition, Fitness Account, and other provider calls. SQL text,
URLs, account IDs, PDF text, and tokens are excluded. The progress response is a bounded 30-second
memory cache keyed by account and source revisions; it is rebuildable after an instance restart.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`.
Neon URLs are normalised with verified TLS, required channel binding, and a maximum local pool
size of 10. Runtime uses the `-pooler` hostname; migrations use its direct counterpart, which
`ConnectionSettings.Direct` derives. No secret belongs in Vite variables or source control.

The application database is `workout` in the `WorkoutApp` Neon project. Neon’s provider-created
`neondb` and `postgres` databases are not application targets. The unused provider-created
`neondb` database was removed on 2026-09-17; `workout` remains the sole application database.

An import's source is the page text the browser extracted, stored on the import row and cleared
as soon as the import reaches a terminal state. An unfinished import expires 24 hours after its
text was stored, which remains the user-visible retention contract. No document, page image, or
object-store copy exists on the server, so there is no import bucket, task queue, or worker
service to provision.

The former `workout-import-worker` Cloud Run service and `workout-imports` Cloud Tasks queue were
retired after the client-side extraction cutover and removed from the project on 2026-09-18. The
`workout-imports-396431756440` bucket is no longer used by deployed code, but still contains five
active PDFs and five retained generations; its application access bindings have been removed.
Delete the bucket only after the retained objects are explicitly approved for deletion.

### Optional Workout rest-alert push

The rest-alert feature uses a new, separate `workout-rest-alerts` Cloud Tasks queue. Each schedule
is first committed as an account- and device-scoped database intent. Task creation is idempotent;
the authenticated internal recovery endpoint retries pending intents once a minute. Before sending,
the API rechecks that the rest generation is current, the workout is active and unpaused, the account
allows rest alerts, and the same device subscription still exists. Rest payloads contain only a
generic title/body and workout route. FCM's successful response is recorded as *accepted by the
provider*, never as proof that a phone displayed it. Recovery can recreate a pending task after its
deadline while it remains within the two-minute expiry window; dispatch is valid until `ExpiresAt`,
not an earlier fixed grace period. A visible Workout window suppresses the system push only after a
bounded reply confirms its signed-in timer owns the same session and generation. Explicit sign-out
tries to cancel the authenticated account's device schedules before logout and invalidates the local
FCM token. If authentication has already expired or the account changes without sign-out, protected
cleanup may be unavailable; delivery still has a short expiry and dispatch rechecks account, session,
preference, and device ownership. OS Focus, connectivity, browser policy, or token invalidation can
still prevent delivery.

As checked on 2026-09-21, the project has no `workout-rest-alerts` queue, no
`workout-rest-task` caller identity, and no rest-alert recovery job; the only listed Cloud Tasks
queue is `receipt-scan`. The former import queue must not be reused. To enable rest push, first
create the separate task identity and queue, and grant the Cloud
Run service account task-enqueue permission, permission to attach that OIDC caller identity, and
Firebase Cloud Messaging send permission. Cloud Tasks and Cloud Scheduler service agents must keep
their Google-managed service-agent roles. One-time setup (run only after reviewing the project):

```powershell
$project = 'project-7eb1aec8-8636-4c86-b2a'
$projectNumber = '396431756440'
gcloud services enable cloudtasks.googleapis.com cloudscheduler.googleapis.com fcm.googleapis.com --project $project
gcloud iam service-accounts create workout-rest-task --project $project
gcloud tasks queues create workout-rest-alerts --location asia-southeast1 --project $project --max-attempts 8 --max-retry-duration 120s --min-backoff 2s --max-backoff 15s --max-doublings 3
gcloud projects add-iam-policy-binding $project --member "serviceAccount:workout-api@$project.iam.gserviceaccount.com" --role roles/cloudtasks.enqueuer
gcloud projects add-iam-policy-binding $project --member "serviceAccount:workout-api@$project.iam.gserviceaccount.com" --role roles/firebasecloudmessaging.admin
gcloud iam service-accounts add-iam-policy-binding "workout-rest-task@$project.iam.gserviceaccount.com" --project $project --member "serviceAccount:workout-api@$project.iam.gserviceaccount.com" --role roles/iam.serviceAccountUser
```

Keep the Cloud Tasks service agent's `roles/cloudtasks.serviceAgent` role, and grant it
`roles/iam.serviceAccountUser` on the dedicated task caller as shown above so it can mint task OIDC
tokens. The identity creating the Scheduler job also needs `roles/iam.serviceAccountUser` on that
caller identity. The endpoint is publicly routable like the existing API but validates the exact
Google OIDC audience and caller email itself; do not remove that validation.

The Cloud Build configuration supplies the project, queue, target URL, OIDC audience, caller account,
and Firebase project ID to Cloud Run. The checked-in Firebase project ID is deliberately
`__not_configured__`; set `_FIREBASE_PROJECT_ID` to a Firebase-enabled project before deployment.
Configure these Vercel `web` build variables from that Firebase project's Web App and Cloud Messaging
settings: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_VAPID_KEY`. These
values are public client configuration, not secrets; restrict the Firebase API key to the Workout
origins. No permission is requested until the user explicitly enables alerts in Settings.

After deploying the migration and API, create the independent minute-level recovery trigger. Cloud
Tasks may execute slightly after a deadline, and this recovery trigger repairs a task-intent insert
that could not reach Cloud Tasks. Its OIDC audience must match `CloudTasks__Audience`; use the same
`workout-rest-task` identity so the internal endpoint accepts only this configured caller:

```powershell
$api = 'https://workout-api-i47taxhzba-as.a.run.app'
gcloud scheduler jobs create http workout-rest-alert-recovery --project $project --location asia-southeast1 --schedule '* * * * *' --time-zone UTC --uri "$api/internal/rest-alerts/recover" --http-method POST --oidc-service-account "workout-rest-task@$project.iam.gserviceaccount.com" --oidc-token-audience $api --attempt-deadline 30s
```

For new builds, `_WORKOUT_API_ORIGIN` must be the Cloud Run service origin, without a trailing slash,
and `_REST_TASK_SERVICE_ACCOUNT` must match the provisioned caller account. If any server or Vercel
configuration is missing, Settings reports closed-app reminders unavailable; local timer, sound,
and wake-lock behavior remain usable. Turning off account alerts or unregistering this device
cancels unexpired task generations. A task already in flight or a push accepted by FCM cannot always
be recalled, so the short expiry limits but does not eliminate stale notifications.

Migrations are applied before deployment and `Database__MigrateOnStartup` stays `false`:

```powershell
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:ConnectionStrings__Database = (neon connection-string --project-id aged-haze-27826198 --database-name workout --role-name neondb_owner --pooled)
dotnet run --project api\Workout.Api.csproj -- --migrate-only
```

## Exercise catalog

The schema ships with an empty catalog and it is the only data users cannot create, edit, or
delete. The checked-in `deploy\exercises.json` contains the 342 default movements. Load it with
the seed command, which is keyed by stable slug, so re-running the same file updates rows in place
instead of duplicating them. Exercises the file omits are left untouched unless
`--deactivate-missing` is supplied. The whole file is applied in one transaction or not at all.

```powershell
$seed = (Resolve-Path deploy\exercises.json).Path
dotnet run --project api\Workout.Api.csproj -- --seed-exercises=$seed
```

Each entry is `{ "slug", "name", "muscle", "equipment", "cue", "aliases": [] }`. Aliases are
matched case- and punctuation-insensitively. Imports also expand common equipment abbreviations,
ignore bracketed grip qualifiers, and remove recognized set-technique phrases before trying a
conservative movement match; ambiguous choices stay unresolved for review. The default file keeps
cues empty because the supplied list did not include coaching text; equipment labels are only
filled when the name makes them unambiguous.
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
