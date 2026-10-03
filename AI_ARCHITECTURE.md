# Ask AI architecture

Ask AI reads training data and proposes existing screens or drafts for explicit review. It never logs sets, starts/finishes a session, changes a program, or changes Nutrition targets. Opening a workout draft only shows the Workouts screen; a session is created only when the user taps a Start button.

## Request flow

`AiEndpoints` → `AiAssistantService` → `AiConversationMemoryService` / `AiBaselineSnapshotBuilder` → `AiAgentEngine` → `AiChatClient` and registered tools.

- The authenticated API owns one active conversation per account. Client history/state are replaced with server memory; `clientTurnId` identifies a retry and conversation ID/version protect against stale devices. EF treats `Version` as a concurrency token. A pending duplicate is a conflict, not a completed reply.
- Closing the panel preserves the conversation. New chat clears local state only after confirmed deletion. Requests abort on unmount; failures retain retry identity/input. Streaming `done` replaces provisional text.
- Baseline context contains account metadata and compact facts from the same active-program/workout read tools. Only IDs present in those compact facts enter action evidence; omitted templates/exercises require a separate tool result.
- Registered tools live in `api/Services/AI/Tools`. `AiToolExecutor` validates arguments, caches within the request, bounds results, and publishes evidence only after a successful result is delivered. Tool names, notes, and user-authored text are data, not instructions.
- `AiActionProposer` validates canonical action names, typed payloads, and current-turn evidence. Workout, exercise, program, and template targets cannot be invented. Workout drafts require a surfaced template ID. At most one action is accepted per turn. The panel waits for Open or Dismiss; accepted proposals open existing app flows with their normal confirmation gates.

## Training semantics

Workout history filters and labels completed sessions using the invocation's IANA timezone (UTC fallback). Canonical loads remain kg and convert to the account's display unit. Timed sets retain duration; disabled RIR tracking suppresses effort fields. Active elapsed time subtracts paused time. Exercise history selects completed sessions by completion time instead of GUID order. Exercise progress is reported set by set: each working set keeps its ordinal, prescription, the suggestion and reason stored when its session started (reasons only for the newest session and a workout in progress, to stay inside the result bound), and how far earlier sets of the same exercise went past their target effort, computed with the progression policy's own `ProgressionFatigue` helper so the model separates carried-over fatigue from lost strength. Sessions match by exercise when it is resolved and by name only for unresolved work, as progression history does, and truncation is reported only when older sessions exist. An optional set number follows one set across more sessions. The next suggestion is not predicted; it is calculated when a workout starts. Catalog searches reuse `CatalogService`, including account-owned custom exercises, aliases, and normalized categories; result limits are marked as truncated. Expected domain errors are handled narrowly so cancellation and infrastructure errors do not become empty training data.

## Bounds, accounting, and retention

- One turn permits four tool rounds plus a final answer, eight read-tool calls, 12,000 characters per result, and 40,000 tool-result characters overall. Prompt history is bounded independently.
- Each successful provider response atomically increments UTC daily chat usage, including responses preceding a later failure. `Ai:ChatDailyTokenLimit` defaults to 100,000 input + output tokens and is checked before each provider call. In-flight responses/concurrent turns can cross the threshold; this is an admission guard, not a strict prepaid spending cap.
- Responses requests use `store: false`; encrypted reasoning items remain within the current loop. Chat model selection uses `OpenAi:Models:Chat`, then existing model fallbacks. Credentials remain server-side.
- Existing scheduled import maintenance prunes completed turns older than `Retention:AiTurnRetentionDays` (default 90) and abandoned pending turns after ten minutes. Usage retains its existing scheduled sweep. Conversations survive panel closure; historical turns are retained for a finite period. `AskAiReviewSafety` adds indexed cleanup dates and records concurrency metadata; migrations run through normal deployment.

## Verification

`tests/AskAiTests.cs`, `AskAiReviewTests.cs`, `AskAiEngineTests.cs`, and `AskAiProgressionTests.cs` cover set-by-set progression with carried-over fatigue, conversation persistence/replay, stale writers, malformed proposals, delivered evidence, compact baseline evidence, custom catalog resolution, local dates/timed sets, retention, accounting, provider failure, and round limits using local fake providers. `web/tests/ask-ai.spec.ts` exercises sign-in, responsive themes, keyboard/hit-testing, saved chat, failed reset, authoritative streaming, and explicit action review. App-level hooks must remain above conditional returns so sign-in cannot change hook ordering.

Run the repository's full backend/frontend unit gates, build, standards/docs checks, and browser gates. Fake-provider and local browser results do not establish live model answer quality, production configuration, scheduler execution, physical Android/Wear behavior, or deployment/migration success.
