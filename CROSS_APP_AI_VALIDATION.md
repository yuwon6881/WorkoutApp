# Cross-app Ask AI validation and rollout

## Implemented contract gates

The workspace `parity/fitness-ai.contracts.cs` and `parity/fitness-ai.examples.json` are canonical. Run `node scripts/sync-fitness-ai.mjs --check` from the workspace root. Each repository consumes vendored DTOs and the same dated workout fixture; producer and consumer tests verify the 18% volume example across local midnight. Backend regressions cover actual intake versus targets/maintenance, missing protein, explicit fasting, archived totals, effective-dated targets, sparse/temporary weigh-ins, zero baselines, planned/active sessions, changed load models, effort preferences, account isolation, authorization rejection, partial/legacy caches, and fresh empty answers.

Local fake-provider and contract tests exercise evidence delivery and bounded work. They do not establish a real model's wording, provider latency, token count, or bill. No paid provider requests are needed for those tests.

## Local implementation verification (2026-10-05)

| Check | Result |
|---|---|
| Nutrition backend (`dotnet test tests/Nutrition.Tests.csproj`) | 529 passed; no skips |
| Workout backend (`dotnet test tests/Workout.Tests.csproj`) | 1,154 passed; no skips |
| Nutrition frontend (`npm.cmd test`) | 427 passed across 89 files |
| Workout frontend (`npm.cmd test`) | 574 passed across 90 files |
| Both frontend production builds (`npm.cmd run build`) | Passed, including TypeScript and build budgets |
| Workout full browser suite (`npm.cmd run test:visual`) | 100 passed, 2 viewport-specific skips; includes Ask AI at 320–1920px, both themes and action review |
| Workout broader responsive suite (`npm.cmd run test:responsive`) | Stopped after four failures on existing 12px `workout-strip-name` labels; the suite requires 14px. Remaining cases unverified. Concurrent UI edits were preserved. |
| Workout additional performance baseline (`npm.cmd run check:performance`) | Failed: initial JS 104,100 gzip bytes versus 101,295 baseline (+2,805); CSS reduction 35.9% passes. This measurement includes concurrent UI edits; attribution was not benchmarked in an isolated checkout. |
| Standards, docs synchronization, shared AI contracts, root parity and whitespace | Passed |
| Both EF migration model checks | No pending model changes |

The existing Workout import-runner test failed once during a concurrent run, passed its focused rerun, and passed the isolated full rerun. No test timeout or threshold was weakened. Browser tests used a local mock provider and isolated disposable databases. No paid model calls, production migrations, deployments, commits or pushes were performed. The forward migrations are present in source; production application remains a rollout step.

## Matched model evaluation before rollout

Use the nine questions and checks in the canonical examples on disposable development accounts with identical dated data, model, history, and provider settings. Compare the prior release with this change. Include greeting, food-only, and progression-only controls that do not require the peer tool. Repeat each question three times from a new conversation. Do not use production/personal-account reset flows.

For every turn, collect existing log entries for model, input/cached/output/reasoning tokens, provider round count, total latency, tool result characters, summary cache hits, and peer reads. Report total tokens across all responses, not only the final response. New cache/peer logs use the existing logging pipeline; no exporter or paid telemetry service is added.

Cost in USD at the reviewed gpt-5.4-mini standard rate is `(0.75 * (input - cached) + 0.075 * cached + 4.50 * output) / 1_000_000`. Reasoning tokens are a subset of output, so do not add them again. Verify current pricing before rollout. Acceptance: average incremental model cost below $0.005 per affected cross-app turn; no systematic extra provider round or peer read for unrelated controls; improved evidence coverage with no unsupported numbers. A model upgrade is not part of this change.

The plateau/maintenance, unintended loss while gaining, return after a break, missing protein, ten-day raw weight loss, and local-week questions require the uncertainty checks specified by each case. A 600 kcal estimated deficit needs qualified maintenance plus intake, not merely a below-target value or a losing goal. An 18% workload increase never directly authorizes calorie changes. Answers must cite dates, source, and coverage and identify hypotheses instead of asserting causation.

## Deployment order

1. Run both repositories' backend/frontend gates, required browser suites, documentation checks, model/migration checks, and workspace contract/parity/whitespace checks.
2. Apply the additive CrossAppAi migrations through the normal controlled deployment pipeline. No live database update is performed by the implementation task.
3. Deploy producer endpoints/contracts before consumers. Old fields and scopes remain supported; an old Workout response without the version header cannot prove complete coverage.
4. Inspect summary latency, cache hits, refresh warnings, and provider rounds using existing logs. Disable/revert the consumer change if quality or cost gates fail; no new infrastructure or scheduled AI work needs removal.

Actual model quality, latency, token spend, migration application, and deployment are unverified until these rollout steps are completed.
