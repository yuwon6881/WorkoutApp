# WorkoutApp cost findings

**Evidence date:** 2026-10-02. This report covers the deployed Workout API and PWA, its independent
Neon database, import/cleanup infrastructure, and the FitnessAccount dependency. Shared billing and
provider measurements are in [`../COST_FINDINGS.md`](../COST_FINDINGS.md).

## Deployed service and measured cost

Production revision `workout-api-00121-rdf` had 100% of traffic at 1 CPU, 2 GiB, concurrency 4, and
a 3,600-second timeout. Request-based billing with CPU throttling is enabled. Revision maximum is 1;
service maximum is 20; minimum is zero/no minimum annotation. The service maximum is a ceiling across
revisions, not 20 observed instances. Keep these limits and billing behavior unchanged.

For 2026-09-01 through 2026-10-01 UTC, built-in Cloud Run metrics reported **18,931 requests** and
**112,620.7 billable instance-seconds**. The maximum aligned p99 across five-minute memory windows
was **0.675 GiB** on the existing 2 GiB revision. Using the current Singapore Tier 2 list rates and
the configured 2 GiB allocation gives about **$4.580 gross** for the interval; this is $0.2544 per
request-active UTC day or $0.00024193 per API request on average. It is not a per-import or per-route
cost, and payable cost may be lower or zero under shared allowances.

At the same measured runtime, the 1 GiB reduction would lower the memory component by about **$0.39
gross** for the observed month (`112,620.7 GiB-seconds × $0.0000035/GiB-second`). It would not halve
the API cost. The production p99 leaves approximately 0.325 GiB below a 1 GiB limit, but cold-start,
large PDF/program, concurrency, maintenance, and restart headroom at 1 GiB has not been measured.
Therefore, retain 2 GiB; no isolated 1 GiB revision was deployed or benchmarked.

## Database, import, and maintenance

The independent `workout` Neon database measured 12,713,984 bytes across 37 public tables. The
largest inspected relations were `TemplateExercises` (680 KiB), `Imports` (640 KiB), and `Aliases`
(448 KiB). Seven expiry/retention-named indexes were found, including source-import expiry,
OAuth-state expiry, session expiry, and rest-alert expiry. Dead-row estimates existed in small tables
but did not demonstrate a storage problem. Read-only table sizes do not measure Neon branch/history,
backup overhead, compute-hours, or billed transfer; those remain unknown.

PDF extraction runs in the browser; no import worker service or Cloud Tasks import queue exists.
The API stores extracted text only for the documented unfinished-import period and deletes source
text at terminal state. The historical `workout-imports-396431756440` bucket remains present, but the
2026-10-02 read-only inventory found zero live objects, zero generations, zero soft-deleted objects,
and zero Workout runtime IAM bindings. It was not deleted; the empty inventory demonstrates no
current object-storage reduction from deleting it.

The daily `workout-import-maintenance` Scheduler request coexists with the hourly in-process
`ImportCleanupWorker` timer. Keep both. The timer is not evidence of an always-on Cloud Run instance;
the API remains minimum zero. Scheduler billing depends on account-wide job count, while sweep
requests, database work, and import volume lack per-operation production meters.

## Normalized unit costs and gaps

| Journey or unit | Evidence available | Cost result |
|---|---|---|
| API request / request-active service day | Cloud Run built-in metrics only | $0.00024193 average gross per API request / $0.2544 per request-active UTC day; not per route or user |
| PDF/program import | No production import-count, token, retry, or journey cost export | Unknown; include browser request, API billable time, OpenAI tokens, polling, peer calls, retries, and terminal cleanup |
| Completed workout | No production completed-workout counter joined to billing | Unknown; include shell/progress/history reads, save calls, identity/peer requests, and any deferred sync |
| AI chat/import extraction | Model is `gpt-5.4-mini`; token mix not exported | Unknown. Current standard-rate formula: `($0.75 × uncached input + $0.075 × cached input + $4.50 × output) / 1,000,000` |
| Rest-alert/maintenance sweep | Task operations and per-sweep DB work unavailable | Unknown; include Cloud Tasks operations, FCM sends, recovery calls, and in-process timer work |
| Identity, Nutrition peer, deferred Google Health sync | API request metric cannot split routes | Unknown; count each peer/deferred request and retry with the originating journey |

The API defines route, database-command, connection, and outbound-call meters, but source inspection
found no production Meter listener/exporter registration. The current built-in Cloud Run request and
memory metrics do not prove per-import allocation, DB wait time, or model usage.

## Decision backlog

- **1 GiB trial — deferred.** Savings are at most $0.39 gross for the measured September usage and
  potentially $0 payable under shared free allowances. Only run an approved isolated trial after
  baseline startup, large PDF/program, status polling, concurrent saves, maintenance, retry/restart,
  and correctness checks. Require no OOM/timeouts and no meaningful latency or correctness regression.
  Roll back by deploying the retained 2 GiB revision. Existing `PERFORMANCE.md` local PDF and API
  results are not a Cloud Run 1 GiB trial.
- **Import bucket — retain.** Zero objects or generations means no storage savings is demonstrated.
  Deletion requires a separate retention-owner approval and a fresh generation/soft-delete preview.
- **Registry cleanup — no Workout candidates.** The dry-run identified only FinancialApp sibling
  images before the package guard; sibling packages are now excluded in the shared cleanup script and
  local policy proposal. The installed provider policy remains in dry-run mode and was not updated.
  Keep it there until active service/job/migration and rollback digests are verified and sibling
  protections are reconciled.
- **No query/cache or retention change.** Current database relations are small and no production
  query plan is tied to a costly journey. Reuse existing read models only after a measured plan or
  latency hotspot; preserve invalidation, offline replay, import, and workout calculation contracts.

**Sources:** `cloudbuild.yaml`, `deploy/README.md`, `PERFORMANCE.md`, `api/Program.cs`,
`api/Services/ImportService.cs`, `api/Services/ImportCleanupWorker.cs`, and the root cross-app cost
report. Current provider price references: [Cloud Run](https://cloud.google.com/run/pricing),
[Cloud Tasks](https://cloud.google.com/tasks/pricing), and
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
