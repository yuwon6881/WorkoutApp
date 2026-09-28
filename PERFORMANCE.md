# Mobile performance implementation and verification

This change improves mobile startup, ordinary workout saves, and optional feature loading while retaining the existing web/Wear mutation contracts and visual effects. It adds no service, paid monitoring, provider reads, or infrastructure configuration changes. Production cost parity still requires a deployed, normalized journey comparison.

## Implemented behavior

- `/api/bootstrap/shell` is additive; the full `/api/bootstrap` remains available to older clients. The shell returns account preferences, active workout, next-workout context, navigation counts, and import summaries. Catalog, template, and program details load when needed. Overview reads progress and history independently, without refetching supplied data.
- Account-scoped memory-only reads share in-flight requests with a concurrency limit of three. Account changes reject old reads; obsolete consumers cancel their requests. Resource generations retain unchanged data and revalidate changed resources. Refreshes protect newer local preferences and workout edits; durable recovery writes and server confirmation remain authoritative.
- Transactional resource generations replace maximum-revision cache signatures. Rebuildable server-side PR/progress records publish within account transactions. Chronological PR summaries append ordinary completions and rebuild after deletions or backdated completions. Exact finish/start timestamp ties use a stable session-ID tie-breaker, including across 64-session pages. Progress rebuilds process 64-session batches. Warm active-set saves reuse completed-history baselines rather than scanning completed sets.
- History lists use deterministic timestamp/ID cursors and summary rows. Expanded sessions load exercises and sets separately. Full history and mutation contracts remain compatible.
- Optional Nutrition context has one cancellation deadline across token acquisition and provider access, outside the account mutation lock.
- Elapsed and rest display ticks are isolated in small components and pause display work when hidden. Deadlines and rest alerts continue to govern recovery. Search normalization/filtering is memoized and result rendering is deferred.
- Sheet pointer writes and navigation indicator measurement coalesce into animation frames. Existing blur, easing, colors, transitions, and reduced-motion behavior remain in place.
- Optional feature CSS loads before a lazy view renders, in deterministic cascade order. Prefetching uses intent plus one idle workout view and respects constrained connections. The service-worker static cache excludes optional PDF/import/settings/program dependencies and never caches API data.
- PDF text geometry/table reconstruction runs in a dedicated browser worker with bounded page work and cancellation. Document bytes remain on the device. Existing annotation ownership, page order, extraction semantics, and mobile page concurrency are retained.
- Active import polling has one owner, shared reads, unchanged successful cadence, bounded failure backoff, and queued pipeline actions. Resume, visibility, and network refreshes are coalesced.
- Existing database counters now measure completed SQL execution duration rather than the pre-execution interceptor callback.

## Rebuildable read models

The additive migration introduces `ResourceGenerations` and `TrainingReadModels`. Source training data remains authoritative. Existing accounts compute a correct fallback on their first read; optional maintenance backfills outside server startup using `--backfill-read-models`. See [deployment guidance](deploy/README.md). No applied migration was rewritten.

## Bundle evidence

Production builds on this checkout compared with the investigation baseline:

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| Entry JavaScript, gzip | 101,295 bytes | 100,964 bytes | -0.33% |
| Initial CSS, gzip | 39,177 bytes | 24,842 bytes | -36.59% |
| Service-worker precache | 1,075.99 KiB | 856.48 KiB | -20.40% |

`npm.cmd run check:performance` enforces the entry JavaScript ceiling and a minimum 25% initial CSS reduction. These are bundle measurements, not field latency or physical-device frame-rate measurements.

## Repeatable checks

Run frontend commands from `web/` and API/corpus commands from the repository root. Use Node 24 and .NET 10. Serialize builds, browser suites, and the corpus gate.

```powershell
dotnet test tests/Workout.Tests.csproj
npm.cmd run check:docs
npm.cmd run check:standards
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run check:performance
npm.cmd run test:visual
npm.cmd run test:responsive
npm.cmd run test:performance
```

Browser runs use a disposable SQLite database and local identity/model stand-ins. For concurrent development, set fresh `WORKOUT_TEST_WEB_PORT`, `WORKOUT_TEST_API_PORT`, `WORKOUT_TEST_OPENAI_PORT`, and `WORKOUT_TEST_IDP_PORT`, plus unique `WORKOUT_TEST_DATABASE`, `WORKOUT_TEST_API_ARTIFACTS`, `WORKOUT_TEST_AUTH_DIRECTORY`, `WORKOUT_TEST_RESULTS_DIRECTORY`, and `WORKOUT_TEST_SCREENSHOTS`. Never point reset flows at personal or production data.

The normal-motion suite runs Android phone-profile workout and touch workflows, records traces, and attaches launch/navigation measurements for ordinary and constrained CPU/network conditions. Its API-byte comparison includes shell, progress, and first-page history together against the compatible full bootstrap. Local browser observations are not a field p75 LCP/INP sample.

API regressions compare PR and progress results with the existing calculators, exercise mutation/deletion/rollback invalidation, and verify warm reads and ten active-set patches on accounts with 0, 100, 1,000, and 3,000 completed sessions. They assert bounded query counts and no completed-history set scan. SQLite timings are diagnostic and do not establish production PostgreSQL p95.

The PDF gate extracts the full local corpus, replays normal and drift readers, and compares independent source expectations:

```powershell
./scripts/test-pdf-import-audit.ps1 -Python <python-path> -OutputFolder artifacts/performance-pdf-audit
```

## Remaining acceptance and release work

- True row virtualization for very large catalog/history/editor surfaces and representative large-program render profiling remain follow-up work. Deferred search and cursor summaries reduce work but do not bound all mounted rows.
- The harness does not yet measure every journey's allocated memory, lock wait, Android WebView execution, or offline/background frame timing. Local normal-motion traces do not establish the absence of every recurring task over 50 ms.
- Physical Android/Wear checks, sustained workout/battery comparisons, keyboard/back/notification checks, and real-device frame timing remain required release evidence.
- PostgreSQL query plans, deployed cold/warm server execution, field p75 LCP/INP/CLS, live optional providers, and normalized production billing/compute/transfer comparisons remain unverified. No evidence-based index change or deployment is included.
- Retain the current CPU, memory, instance limits, billing mode, database tier, model configuration, and active-import polling cadence. A deployment must apply the additive migration before new server code and preserve compatibility during rollout.

## Verification record

- Frontend: 375 unit tests passed; type, standards, documentation equality, production build, and compressed bundle budgets passed.
- Visual workflow suite: 50 passed, with two intentional non-desktop settings-scroll skips. Final artifacts: `web/artifacts/performance-verified/`. Phone/tablet/desktop screenshots were inspected, including light-theme dialogs and the mobile logger.

Earlier failed browser runs exposed coordination and stale fixture/transition assumptions; they are not counted as passing evidence.
- Responsive suite: all 44 passed across 320/390/640/768/1024/1440/1920 px and both themes. Expanded cursor history and lazy session details are included. Final artifacts: `web/artifacts/performance-responsive-final/`; 390/768/1440 px logger screenshots in both themes were inspected.
- Normal-motion mobile workflows: 18 passed, with one intentional desktop-only settings-scroll skip. This includes real touch dragging, keyboard behavior, import recovery, workout logging, and Back navigation. Traces: `web/test-results/performance-motion-verified/`.
- Local startup API comparison on the exercised account: shell + progress + first history page totaled 1,000 gzip bytes versus 1,980 for the compatible full bootstrap (49.5% smaller). Each startup read occurred once. This is a local fixture comparison, not a production transfer/cost sample.
- Final paint-observer measurement rerun: all four setup/launch checks passed. Ordinary launch: usable heading 404 ms, LCP 652 ms, CLS 0. Constrained launch (4x CPU, 100 ms latency, 200 KB/s download): usable heading 3,244 ms, LCP 3,076 ms, CLS 0.00131. The constrained sample exceeds the 2.5-second LCP target; these two samples do not establish field p75. Startup long tasks remained (ordinary maximum 110 ms; constrained maximum 752 ms). No INP sample was produced by these launch observations. Reports: `web/test-results/performance-metrics/`.
- Final API suite: all 893 passed, including a 70-session identical-timestamp PR rebuild/deletion regression across cursor batches. Results: `tests/TestResults/performance-final.trx`.
- Warm local SQLite set-patch diagnostics (ten service calls per fixture): 0/100/1,000/3,000 completed sessions measured p95 2.59/3.97/1.96/2.19 ms, with 13 SQL commands per save at every size. Warm PR/progress reads and saves did not scan completed-history sets. These small service samples exclude network/HTTP serialization and are not production p95 guarantees.
- Full PDF gate: 39 PDFs and 45 program choices passed normal/drift replay and independent coverage, source-hash, prescription, and demo-link checks; zero failing branches/checks. Report: `artifacts/performance-pdf-audit/source-audit/`. The extraction/reconstruction implementation and source expectations were unchanged semantically.
- Android Capacitor project: `assembleDebug` passed (274 Gradle tasks up to date). No device was attached to ADB, so this is compile evidence only.
- Wear companion project: `assembleDebug` passed (39 Gradle tasks, three executed). No watch or emulator was attached; UI/runtime compatibility remains unverified on a device.
