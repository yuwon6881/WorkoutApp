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

## Implementation evidence — 2026-10-02

This change preserves infrastructure capacity, scale-to-zero, database pools, provider backoff, AI usage, credentials, and authoritative training calculations. Existing unrelated work in both app repositories was preserved. Master commits and pushes are authorized for the three independent repositories; production deployment and seven-day observation have not been performed.

Implemented: thin `/api/bootstrap/launch` and projected import summaries; latest-run/relevant-progress reads; bounded recent exercise sets; account-scoped local recovery alongside bootstrap; catalog loading on action; shared priority admission with three read slots and one optional slot; common absolute transport deadlines; committed-save/deferred Google Health capability negotiation and coalesced awaited dispatch; device-authenticated Wear dispatch; focused peer training accounting; revision/date-derived insight reuse; authoritative routine acknowledgement; browser render windowing above 100 catalog/history rows; packaged Android assets at the existing origin, network API interception, and origin-owned native worker retirement. Nutrition retains partitioned persistence and runtime-only steps, defers saved-food hydration, reuses full-history trend/context calculations, supports cached peer summaries, and refreshes affected data after imported weights. Database connection acquisition now has a separate passive histogram from SQL execution.

Fresh pre-change checkout entry JavaScript was 113,532 bytes gzip; the frozen gate ceiling remains 101,295. The verified build reached 101,177 bytes (10.9% below this checkout baseline); initial CSS was 23,570 bytes, 39.8% below the gate baseline. These totals include existing concurrent changes and cannot all be attributed to this patch. Nutrition first-load/precache gates remain 433/434 and 1168/1170 KiB.

The local browser performance suite passed 20 tests, with one existing skip. Startup reads totaled 1009 gzip bytes against 2118 for legacy bootstrap. Ordinary sample: usable 770 ms, LCP 784 ms, CLS 0.00132. Constrained sample (4x CPU, 100 ms latency, 200 KB/s): usable 3032 ms, LCP 2868 ms, CLS 0.03791. Constrained LCP exceeds the 2.5-second target. These are single local samples; they do not establish production p95, INP, hardware timing, cold-service behavior, or cost improvements. Reports: `web/test-results-performance-implementation/`.

Final backend runs passed 1096 Workout and 501 Nutrition tests. Frontend runs passed 507 Workout and 407 Nutrition tests, including response-body deadlines and rollout read compatibility. Workout visual workflows passed 88 tests with two existing skips; responsive workflows passed all 44 across seven widths and both themes, plus a final eight-test phone/tablet/desktop rerun after the skeleton changes. Normal-motion/performance workflows passed 21 with one existing skip, including account-pending local recovery with zero dispatched mutations. Both Android phone projects and Wear passed lint, JVM unit tests, and debug APK builds; phone assets were resynchronized and rebuilt after frontend changes. Native document-start script tests exercise the shipped script's scoped retirement and failure behavior. Earlier failed fixture/timing-sensitive runs are not counted as passing evidence.

Hosted clients retain compatibility while backend endpoints roll out: only 404 responses from the new launch/recent-sets reads use their previous read paths. Authorization, timeout, and other errors are still authoritative; ordinary mutations are not retried. The legacy past-sets path remains limited to three sessions and propagates cancellation. Optional logger prefetch was removed so its code cannot compete with the first visible screen; logging still loads on action. No steady-state extra API requests are added by these fallbacks.

Registration defaults and deployment overrides are now one account in both apps and FitnessAccount. Existing mapped subjects and credentials remain usable at capacity. FitnessAccount hides its registration link and rejects direct and stale-form registration requests; all 33 identity tests passed. Production behavior changes only after deployment. Nutrition's extended browser benchmark and its unmet navigation/save targets are recorded in `../NutritionApp/PERFORMANCE_IMPLEMENTATION_FINDINGS.md`.

Final repeated launch checks passed 17 tests (two setup plus five repetitions of recovery/normal/constrained launch). On the same empty-account fixture, normal usable/LCP p50 was 665/664 ms and nearest-rank p95 was 752/748 ms, with CLS zero. Constrained usable/LCP p50 was 4460/4108 ms and p95 was 5725/5112 ms; CLS p95 was 0.00456. Startup responses totaled 468 gzip bytes versus 948 for compatible bootstrap. A diagnostic run identified a lazy-stylesheet loading defect: seven calendar placeholders initially stacked vertically, producing CLS around 0.36. Initial skeleton grid styles and matching calendar placeholders fix that defect; the launch suite now retains shift-source rectangles and enforces the unchanged 0.1 CLS target. Reports: `web/test-results-launch-compatibility-final/` and `web/test-results-launch-diagnostic/`. Five samples are diagnostic, not a representative production p95. Constrained LCP still exceeds 2.5 seconds, long tasks remain, and no INP sample was produced. These post-change fixtures are not a paired pre-change journey benchmark.

FitnessAccount's real local browser flow verified first-account registration, closed registration afterward, existing-account sign-in, and sign-in pointer hit-testing at 390/768/1440 px in both themes, including a 520 px phone-height viewport. No production account was created.

The final single-run launch report observed normal usable/LCP 640/608 ms and constrained usable/LCP 4197/3980 ms, with CLS 0.00132/0.01580. Startup reads were 1013 gzip bytes versus 2117 for compatible bootstrap. Constrained startup remains outside target and varied materially between runs; retain the long-task/resource traces and collect isolated repeated measurements. Reports: `web/test-results-performance-final/`.

Read-only Cloud Run inspection confirmed current revisions `workout-api-00120-t2g` and `nutrition-api-00049-96q`: Workout 1 CPU/2 GiB/concurrency 4/3600-second timeout, Nutrition 1 CPU/512 MiB/concurrency 20/180-second timeout. Each revision has `autoscaling.knative.dev/maxScale=1`; both service-level annotations still show maxScale 20. No minimum-instance annotation was present. Workout explicitly retains CPU throttling. These existing settings were not modified; rollout must retain the effective one-instance revision caps and zero minimum.

Acceptance remains open for reference-device paired launch/write/input runs, hosted-to-bundled APK upgrades with old workers and live cookies/recovery/outboxes, physical Wear completion, PostgreSQL plans and connection waits, live consent/provider 429/unknown-outcome validation, complete deployed warm/cold traces, sufficient paired repetitions, and seven days of normal traffic/billing comparison. Deferred dispatch adds HTTP requests: normalized cost must include them and cannot be inferred from faster acknowledgements. No targets or ceilings were relaxed. No paid service, always-on worker, keep-alive traffic, extra scheduled job, or tier/capacity increase was added.
