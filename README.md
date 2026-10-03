# Workout

During a workout, swipe between exercises or select one from the top strip. Each set has editable weight, reps, RIR, and a completion tick; add or remove sets from the same screen. Each set's target column shows the same set from the last finished session (reps and recorded RIR), falling back to the plan's target. Tick a set to log it; the rest timer appears under the header while resting, and Finish appears once every working set is logged (it is always in the options menu, beside the workout details). Exercise notes and available demo links remain accessible. Swaps use the exercise library and are available before completing any sets for that exercise. Automatic rest runs after working sets (including myo-reps and the final set) and after the last warm-up; intermediate warm-ups and immediate superset handoffs skip rest.

A workout tracker with an account-backed database and an AI program importer. One repository
holds the React PWA (`web/`) and the ASP.NET Core API (`api/`), following the same layout as the
sibling NutritionApp.

| Directory | What it is |
| --- | --- |
| `web/` | React 19 + Vite + TypeScript PWA, deployed to Vercel |
| `api/` | ASP.NET Core 10 minimal API on PostgreSQL (Neon), deployed to Cloud Run |
| `tests/` | xUnit tests for the API |
| `wear/` | Kotlin + Compose standalone Wear OS companion |
| `deploy/` | Deployment, seeding, and recovery notes |

## Run it locally

Requires Node 24 and .NET 10. Building the watch app also requires JDK 17 and Android SDK 36.

```powershell
cd api;  dotnet run                       # http://localhost:5183 with a local SQLite file
cd web;  npm ci;  npm run dev             # http://localhost:5182, proxying /api to the API
cd wear; .\gradlew.bat :app:assembleDebug # Wear OS debug APK
```

In development the API falls back to SQLite when no connection string is configured, so nothing
external is needed to work on the app. Point `WORKOUT_API` at another origin to proxy elsewhere.

## Android phone builds

From `web/`, run `npm.cmd run android:sync`, then from `web/android/` run `.\gradlew.bat lintDebug testDebugUnitTest assembleDebug` with JDK 21 and Android SDK 36. Settings shows both the web version and the installed Android version/build. Native changes require a newer APK signed with the same key; install it in place to preserve saved work. Local builds use version 1.0.1/build 2. CI uses `1000 + GITHUB_RUN_NUMBER`; release tooling may override `ANDROID_VERSION_CODE` with a code greater than the last distributed build. Preserve the workflow counter or supply a higher code if replacing it.

Recovery writes reject failed SQLite inserts. A future running rest is rearmed after reboot, package update, or an exact-alarm permission grant. Notification-enabled rests use the native rest channel in both foreground and background; Settings reports a blocked channel or muted channel sound and links to its Android settings. Local-only foreground sound remains available when rest notifications are turned off. The bundled offline recovery view remains read-only; Retry explicitly reloads the failed WebView. Full cold-start offline logging and Xiaomi Super Island are not implemented, and physical-device delivery is not certified by these checks.

Google Health consent opens Settings in the system browser. Sign in there with the same FitnessAccount account, connect Google Health there, then return to the app. The browser uses its own session; no native cookie is transferred. The app refreshes connection status on return. Session/bootstrap reads precede optional launch reads; Google Health status returns independently of queued uploads. Status requests have a 15-second deadline including queueing and retry waits, with at most two automatic recovery attempts for temporary availability failures. Upload passes cancel in-progress provider calls when their budget expires, preserving leases and ambiguous outcomes for safe recovery. The existing scale-to-zero configuration and daily maintenance sweep remain sufficient; no new scheduled wake-up is required.

## Test Wear OS without a physical watch

Use a Wear OS virtual device, not a phone AVD: in Android Studio Device Manager, create and start
a **Wear OS Small Round, API 36** device. The same Wear APK and watch screens run in this AVD.

Start the API and web app in separate terminals using the local-development commands above. Then,
from `wear/`, install and launch the emulator build:

```powershell
.\scripts\install-on-emulator.ps1
```

The script points the debug APK to `http://10.0.2.2:5183`, which reaches the API on the development
host from the emulator. Debug builds allow HTTP only when this local origin is selected; release
builds keep cleartext traffic disabled. If more than one emulator is running, pass its ADB serial:

```powershell
.\scripts\install-on-emulator.ps1 -Serial emulator-5556
```

Sign in to the local web app, approve the code under **Settings → Wear OS**, and start a workout
from the web app. A paired watch checks for a workout when it opens or resumes, and checks again
every 15 seconds while its no-workout screen is open. The Android app (`web/android/`, Capacitor) starts
workouts through the same account-backed workout API; the watch reads the server's active workout regardless of
which client started it. The virtual device uses the same app behavior and layout, while physical
vibration strength, battery use, and manufacturer-specific screen behavior still require a watch.
Android foreground-service classification also needs release review; Play approval and physical-watch
power/timing measurements are not claimed. See `wear/README.md` for the documented manual-logging
use case, permission prerequisites, and reproducible 20-set measurement protocol.

## UI text and type

Visible interface text uses the shared Ayu typography scale in `web/src/index.css`: 16px body and
form text, 14px navigation, metadata, badges, and secondary text, 20px section headings, and
28–32px page titles. Keep labels factual and concise, remove repeated slogans, and keep warnings,
targets, provenance, and server or permission consequences visible. Use a keyboard-accessible
`details` disclosure for diagnostics or supporting instructions that do not help the current
decision. Passive status rows are regular content; only rows with an available action use buttons.

## What it does

- Central identity via Fitness Account OIDC (`openid`, `profile`), capped at two accounts,
  with hashed local sessions in a 30-day `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`workout-session`),
  origin and custom header CSRF checks, and rate limits. No user credentials or passwords are stored in WorkoutApp.
- Workouts built by hand, or imported from a training PDF by AI and corrected in a review screen
  before anything becomes a program.
- Set logging with weight, reps, and RPE; the next session is prefilled but never pre-logged. Durably saved workout state survives ordinary app termination and explicit Android Force stop (backed by native SQLite in `noBackupFilesDir` on Android and account-scoped IndexedDB on web/PWA); reopening reconstructs the correct session and remaining rest. In the Android app, an active workout runs a `specialUse` foreground service with one ongoing notification: elapsed time, the rest countdown, or the paused state, with generic lock-screen text and a Return-to-workout action, promoted to a Live Update on Android 16 where allowed. The rest-complete chime plays once per rest on each device, whichever of the app and the deadline alarm claims it first. Settings show notification and precise-timing access and offer a test alert; scheduling an alert is never reported as proof that it arrives.
- A standalone Wear OS companion joins an active workout after short-code approval in WorkoutApp settings. Its device session reads only the live workout and changes only logged values (reps, load, RIR, done); starting, restructuring, and discarding workouts stay on the phone. It logs reps, load, and RIR with undo of its last logged set; manages rest, pause/resume, and confirmed finish; and queues watch changes locally for ordered, revision-aware replay after network gaps. A rest started, extended, or skipped on either device is shared through the server and taken over by the other the next time it syncs or opens the workout; each device alerts on its own (watch vibration, phone chime), and a rest that changed on the other device is held for review rather than overwritten. Revision-only server bumps rebase cleanly; same-set and finish conflicts remain available for review; edits WorkoutApp refuses, or that target a workout already finished or discarded on the phone, are released with a notice instead of retrying forever. An ongoing activity returns to the workout from the watch face, and rest completion vibrates once via a bounded rest wake lock. Pairing codes expire after five minutes; the revocable device link renews while in use and expires after a year idle. Pairing secrets are encrypted with Android Keystore; the server remains authoritative for workout state.
- Progression uses each completed working set's history, prescribed reps and effort, and the exercise's load increment. Reps build at the same load; reaching the range ceiling at suitable effort earns the next available weight with an estimated rep goal. An exact target one rep above the last result is a normal progression attempt, not an automatic failed session.
  - An initial hard exposure retains achieved reps (clamped to the prescribed range) to match intended effort rather than dropping to the prescription minimum.
  - For a confirmed Nutrition loss goal, the product's preservation heuristic requires 2 consecutive exposures at the same load and prescription, each reaching the latest rep result with at least one extra rep in reserve beyond the target effort, before advancing ordinary in-range reps. Missing effort or a missing target holds reps; changed prescriptions or loads break evidence continuity. This is a product heuristic, not a scientifically mandated threshold. Gain goals remain on standard progression; a goal label alone does not establish a calorie surplus.
  - Evidence rules on top of double progression: (1) a weekly RIR taper of up to two reps (for example 3 → 2 → 1) keeps the prior set as valid evidence when it met the new target, while larger or unmet target changes still reselect the load; (2) history is limited to exposures of the same rep range and target within 14 days when another day trains the same exercise differently, and planned deloads (target three or more reps easier) are ignored; (3) after 15–27 days away the last load and reps repeat, after 28 days the load is about 10% lighter and after 56 days about 20% lighter; (4) in normal mode a set at least two reps easier than both the new and its own target takes a capped larger step (at most 10% or two equipment steps) or up to three extra in-range reps; "5+" RIR is a lower bound, so the cap still applies; (5) four sessions at one load with no rep gain at or beyond target effort reset the load about 5% in normal mode, and hold during a calorie deficit; (6) RIR-only sets contribute to the strength trend when their RIR is 0–4.
  - A confirmed maintenance, gain, or finished-phase Nutrition context whose qualified observed loss (at least three weigh-ins over 14+ days) is 0.5% per week or more selects conservative progression, because the goal does not explain the deficit. It never selects preservation. Gain goals otherwise stay on standard progression.
  - Active workouts display an accessible progression summary with the stored mode, recorded Nutrition goal when fresh at workout start, and its reason. It uses the frozen session context and stored suggestions; stale or unconfirmed Nutrition data is identified rather than re-evaluated from current data.
  - Workout start and Ask AI reuse successfully refreshed Nutrition context for six hours while the connection grant is active, without a token exchange or peer request. `Integrations:NutritionContextFreshHours` configures this window (0 disables it; clamped to 0–168 hours). Older or missing context triggers the existing two-second live read and seven-day cache fallback. Opening Settings checks connection status; Connected apps → Refresh always requests live context with an eight-second bound. Nutrition goal changes may take up to the freshness window to appear unless manually refreshed; progression mode rules are unchanged.
  - Changed rep/RIR prescriptions reselect a suitable load. Missing target RIR does not silently become RIR 2, and recorded 5+ RIR remains useful effort evidence. Without recorded effort, repeated top-range results are required before a cautious increase.
  - A large minimum weight step may temporarily suggest fewer reps only after the top of a range is earned: at least 60% of the lower bound and never below six reps. The saved transition rebuilds toward the original range without overwriting the prescription or treating fewer reps alone as failure. Impractical jumps stay at the current weight. A modest step may aim one rep above its estimate while staying inside the prescription.
  - Unspecified/AMRAP rep targets remain empty. Load increases require repeated improving performance at the same load (at least two sessions with effort, three without); the engine never treats these sets as having a one-rep ceiling. Recovery suggestions cannot exceed the current load.
  - Load/reps calculations are approximate starting points, bounded to 30 effective reps; they do not change PR calculations or guarantee an RIR. Suggestions remain frozen for the session, never pre-log a set, and preserve account-scoped history and bodyweight context.
  - `api/Domain/LoadOptions.cs` supplies fixed increments, uneven available-weight lists, bounds, and next/previous weights independently of progression. `api/Domain/LoadResolution.cs` picks each exercise's own rule, then the account equipment rule (`api/Domain/EquipmentGroups.cs`, keyed on equipment and load model), then the app default. Plate-held and weighted bodyweight exercises share Plate-loaded; medicine balls default to 1 kg. Rules use a fixed step or an available-weight list. Edit equipment defaults in **Settings → Weight increments** and individual rules under **Weight settings** in exercise details or the active exercise menu.

  RPE decides the pace, a hard or missed session holds, and a lift that has not moved for two
  sessions is offered a lighter week. Strength is estimated with Epley extended by reps in
  reserve (up to 12 effective reps) — a set is rated as if it had been carried to failure — and a set outside the range
  that equation holds produces no estimate rather than a misleading one. Separate rep PRs compare
  completed working sets by exercise, load model, resistance mode, and canonical comparable load; full-bodyweight
  records require the workout's frozen system load, loadless movements compare reps without weight, and unknown
  weighted loads are ineligible. A first exposure establishes a baseline, ties do not win, and high-rep sets can earn
  rep PRs without an e1RM. Live celebrations, set markers (`pr-set-tag`), and exercise history badges
  (`pr-exercise-badge`) distinguish "Rep best", "Estimated strength best", and combined records, while counting
  each exercise once in session PR summaries. Technique sets (partials, lengthened and integrated partials,
  myo-reps, drop sets) count as sets and volume but never as strength: they set no records, raise no bar
  a later set must beat, and leave the strength trend alone. Their progression learns only from the
  same technique, and one that follows straight sets starts at the straight-set load. Every suggestion says
  in words why it changed, and a program's own reps and RPE are never overwritten.
- The Body tab shows completed working-set coverage by muscle for the last week, month, or three
  months. Each set credits its primary muscle fully and secondary muscles at half weight; fixed
  weekly bands keep the map colors consistent, and unresolved exercises are listed as unattributed.
- A rest timer that survives a locked phone: it is stored as a deadline rather than a countdown,
  the screen is held awake while it runs, and the end tone is queued on the audio clock ahead of
  time so it still sounds with the screen off. If the browser closes the app outright, the timer
  is still correct on return and reports what was missed. The displayed remainder never exceeds
  the configured duration, including immediately after starting or extending rest.
- Programs run in phase order: finishing or explicitly skipping every training slot completes a
  phase, and the next Monday starts the following phase. The final phase moves the program to
  Completed; imported programs wait in Standby until scheduled and activated.
- A PDF program is read on the device: the browser extracts the text layer with pdf.js and posts
  only that text, gzipped, so a 70 MB illustrated training book never leaves the phone or laptop
  and no page image is ever sent to a model. Up to 1,000 pages are accepted. A first cheap pass
  reads a page-by-page view to find the pages that actually carry the schedule — commonly ten
  pages out of a hundred — and only those pages are read in full. Clean table pages can be read
  locally even when the surrounding section still needs interpretation; unresolved pages keep
  their schedule headings and footnotes when sent for a model read. Sections run concurrently (up
  to eight) and commit in outline order. Pages decode two at a time on desktop and one at a time
  on phones and low-resource devices. Pages
  with no selectable text contribute nothing and are reported rather than guessed at; a scanned
  document has to be re-saved as a text PDF. The extracted text is held for 24 hours so an
  interrupted read continues, and is dropped as soon as the draft is complete. Source analysis is
  reused through transcription and verification. A corrective read targets up to two complete
  affected page groups when their source ownership is unambiguous, and completed responses and
  metered retry reservations survive a server restart. A printed week choice is reconciled before
  week-gap checks run; the chosen branch is checked again before it is ready. Progress distinguishes
  saved section responses from committed sections and stays indeterminate during verification. The
  model, reasoning effort, request limit, and per-read budget are unchanged.
  Saved stopped imports stay in a collapsed list and open only when chosen. Reloading or discarding
  a different draft does not select an older error; live reads and ready drafts resume newest first,
  including straight after a discard. A failed import is listed for one day and then swept, and a new
  read of the same PDF replaces its earlier failed attempts.
  Choosing a new PDF clears the previous attempt's detail panel while the new file is read.
- Imported prescriptions retain per-set techniques such as partial reps, lengthened partials, and
  integrated partials. Row instructions for top- or bottom-half ROM work are recognized too, including
  fractions such as `1/2`, `½`, and `3/4` of the range of motion, affirmative short-ROM cues, and
  compound sequences such as 7/7/7; their printed rep notation stays intact, and when the note spells
  out the same segments inside one set the rep target is their total (21 for 7/7/7). Printed set qualifiers
  determine the working sets that receive a technique, and the active workout labels those sets while
  keeping the source cues. When a counted ROM sequence conflicts with the printed rep target, import
  review flags the source page and rep field for a choice instead of silently changing either value.
  Count-only warm-ups retain the printed count without copying working-set rep or tempo targets;
  separately printed warm-up rows keep their own prescriptions. Timed holds retain duration text
  without treating seconds as repetitions. An open-ended base such as `AMRAP/2` keeps its
  notation without treating the forced negatives as the base rep target. Tables with an unlabeled
  exercise column retain that column from the printed geometry, keeping counts out of wrapped names.
  Instructions referring to a working set beyond the
  stated count also require review, preserving both the count and the original instructions.
  An explicit final-set failure instruction beneath a table applies to that session's working
  sets; conflicting exercise-specific instructions remain visible for review. An `RPE 9 TEST`
  rep cell prescribes effort without inventing a repetition count. Coaching text printed beneath
  blank tracking columns stays in the exercise notes. Demonstration annotations retain their
  original destination casing, wrapped addresses retain their continuation and start time, and
  repeated links retain page ownership when another page offers a different demonstration.
- Kilograms are canonical; pounds are a display conversion.

## Data boundaries

The API remains authoritative for training data. The web client keeps an account-scoped active
workout recovery record and ordered edits in IndexedDB, and the Wear OS app keeps its active
session snapshot, ordered operation outbox, and rest deadline in its private SQLite database so
the user can continue logging through network gaps. Both clients reconcile through server
revisions; the watch holds same-set or finish conflicts for explicit review. The service worker
precaches the static shell only; API responses are `no-store` and never fall back to the SPA
document. The watch stores its revocable device token encrypted with Android Keystore.

The exercise catalog is global and read-only to users: only the seed command writes it. The
production default catalog is checked in at `deploy/exercises.json`; a fresh schema remains empty
until that file is loaded. Imported PDFs are held in a private transient source store only while
extraction can resume, expire after 24 hours, and are deleted once the import reaches a terminal
state. A weight that was not recorded stays unknown and is left out of volume
totals rather than counted as zero; a zero weight is a real bodyweight set.

Unfinished sessions stay drafts until the workout is saved, and only completed sets enter history.
No proprietary MacroFactor algorithm, exercise videos, paid programs, or account integration is
included.

## Verification

```powershell
dotnet test                    # API: auth, tenancy, RPE and set rules, seeding, AI import, programs
cd web;  npm test              # unit: unit conversion, prescriptions, the save pipeline
cd web;  npm run build         # strict TypeScript and the production PWA build
cd web;  npm run test:visual   # end-to-end on Chrome at 1440px, 768px, and an emulated iPhone 13
cd web;  npm run test:responsive  # every view and dialog at 320-1920px in both themes
cd wear; .\gradlew.bat testDebugUnitTest :app:assembleDebug
```

The end-to-end suites run the real API against a disposable SQLite database and replace the AI
provider with a local stand-in, so an import can be exercised without a paid call. Playwright uses
installed Google Chrome; screenshots are written to the ignored `web/artifacts/` directory.

PDF prescription verification uses independently extracted and reviewed expectations for all 39 local PDFs and 45 program/week choices in [tests/Corpus/SourceExpected](tests/Corpus/SourceExpected/README.md). After a fresh browser-equivalent extraction, run `CorpusReport` with `WORKOUT_PDF_CORPUS` and `WORKOUT_CORPUS_DUMP=1`; it replays normal and drift readers. Run `scripts/pdf-audit-gate.py` with the saved source fixtures to enforce hashes, choice/page coverage, exercise order, set prescriptions, technique scope, rest midpoints, and demonstration ownership. Missing expectations and field mismatches fail with source locations. This verifies the local reader and reconciliation; it does not certify a live model provider.

## Deployment

See [deploy/README.md](deploy/README.md) for the Neon, Cloud Run, and Vercel setup, the exact
resource names, and how to load the exercise catalog.

### Personal exercise weights

**Settings → Weight increments** holds equipment defaults as fixed increments or available-weight lists (for example 2 kg dumbbells or cable weights of 2.5/5/7.5/10/15/20). One **Plate-loaded** setting covers bars, plate-loaded machines, plate-held movements, and added load on weighted pull-ups/dips and other full-bodyweight moves. Its app default is a 2.5 kg total step; medicine balls default to 1 kg. Weight-stack machines keep their physical equipment classification and can have individual rules. To change one exercise, open it in the Exercises library, or choose **Weight settings** from the exercise's three-dot menu during a workout, then **Edit weights**. Keep the default, set an increment (0 means progression through reps only; per-side entry doubles the plate increment for equipment loaded on both sides), or type/fill the available weights. Plate-held and weighted bodyweight exercise rules use total change. Individual rules are managed with the exercise, rather than listed in Settings. Rules belong to your account and follow the exercise across programs without editing the shared catalog. Use the same load convention as your logs: per dumbbell, or total barbell/machine/added load. An increment keeps the unit it was typed in: after switching between kg and lb it reads as the nearest step that unit's equipment has (2 kg dumbbells read as 5 lb), and switching back shows exactly what was typed. Available-weight lists are physical weights and are only converted for display.

Weight editing opens a focused dialog from Settings, exercise details, or the active exercise menu. Weight lists use a short comma-separated field; **Create a sequence** optionally fills it from a first weight, last weight, and step, then returns to the list for adjustments. Sequence errors stay with the helper and do not block a valid manual list. Exercise details show a compact weight summary and a single empty-state message until there is recorded workout history, without empty charts, record cards, table headings, or a disabled history action. Existing history and range controls remain available when recorded data exists.

The load-settings migration removes named reusable weight stacks and their references after copying each owner's saved step or list into the referring exercise/equipment rule. Existing exercise overrides stay intact. When merging former Plate and Added load defaults, the existing Plate-loaded rule wins; if absent, a configured Plate rule wins, then Added load. Former group rows are removed. Downgrading restores the old schema but does not reconstruct deleted stack names or former group divisions.

**Settings → Weight unit** switches between kg and lb. Exercise settings use that unit and are stored in canonical kilograms. Saved weights are converted when the unit changes, not reinterpreted. Available-weight lists are sorted and deduplicated; manual logging remains free to record the actual load. New workouts and exercise swaps use these settings for progression, including added load and assistance; changing settings leaves existing workout drafts and completed history untouched. Choose **Use default** to restore the inherited equipment or app rule. Concurrent edits are rejected with a reload action.

## Mobile performance architecture

The web/Android shell uses `/api/bootstrap/shell` for account/preferences, the active workout,
next workout, active program, navigation counts, and unfinished import summaries. The original
`/api/bootstrap` and workout mutation response contracts remain available to older clients and Wear.
Catalog/program/template reads load on demand; account-scoped in-flight reads share a bounded
three-request pipeline. Committed resource generations retain unchanged resources across refreshes.
Pending preferences and workout recovery updates take precedence over older shell responses.

PR attribution and completed-history baselines use rebuildable, versioned database read models.
Ordinary set patches reuse those baselines. A chronological completion can append; a deletion,
backdated completion, or historical edit rebuilds attribution in bounded source batches. Progress
uses a daily, generation-keyed durable aggregate and a bounded memory cache; cold rebuilds load
64 sessions at a time. Neither cache changes the source of truth. History lists use deterministic
cursor summaries and fetch full exercise/set detail only when expanded.

Elapsed/rest displays tick in their own visible components. Sheet pointer writes and navigation
indicator geometry updates are coalesced into animation frames. Optional feature CSS loads before
the shell stylesheet in a stable order, preserving themes and motion values. Prefetching responds
to navigation intent and warms one likely workout view while idle, respecting constrained connections.
The offline precache retains workout/recovery dependencies and defers optional import/settings/chart
assets. PDF page reconstruction runs in a device-local worker with the existing one/two-page memory
limits; PDF bytes remain on the device. Import polling retains its successful two-second cadence,
shares in-flight status reads, aborts obsolete watchers, and backs off transport failures.

See [PERFORMANCE.md](PERFORMANCE.md) for local measurements, repeatable checks, and release limits.
