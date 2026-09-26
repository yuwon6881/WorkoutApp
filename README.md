# Workout

During a workout, swipe between exercises or select one from the top strip. Each set has editable weight, reps, RIR, and a completion tick; add or remove sets from the same screen. Past sets show the last three completed sessions for the library exercise, including recorded RIR. Exercise notes and available demo links remain accessible. Swaps use the exercise library and are available before completing any sets for that exercise. Automatic rest runs after working sets (including myo-reps and the final set) and after the last warm-up; intermediate warm-ups and immediate superset handoffs skip rest.

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
- Set logging with weight, reps, and RPE; the next session is prefilled but never pre-logged.
- A standalone Wear OS companion joins an active workout after short-code approval in WorkoutApp settings. Its device session reads only the live workout and changes only logged values (reps, load, RIR, done); starting, restructuring, and discarding workouts stay on the phone. It logs reps, load, and RIR with undo of its last logged set; manages rest, pause/resume, and confirmed finish; and queues watch changes locally for ordered, revision-aware replay after network gaps. Same-set and finish conflicts remain available for review; edits WorkoutApp refuses, or that target a workout already finished or discarded on the phone, are released with a notice instead of retrying forever. An ongoing activity returns to the workout from the watch face, and rest completion vibrates once. Pairing codes expire after five minutes; the revocable device link renews while in use and expires after a year idle. Pairing secrets are encrypted with Android Keystore; the server remains authoritative for workout state.
- Progression uses each completed working set's history, prescribed reps and effort, and the exercise's load increment. Reps build at the same load; reaching the range ceiling at suitable effort earns the next available weight with an estimated rep goal. An exact target one rep above the last result is a normal progression attempt, not an automatic failed session.
  - Changed rep/RIR prescriptions reselect a suitable load. Missing target RIR does not silently become RIR 2, and recorded 5+ RIR remains useful effort evidence. Without recorded effort, repeated top-range results are required before a cautious increase.
  - A large minimum weight step may temporarily suggest fewer reps only after the top of a range is earned: at least 60% of the lower bound and never below six reps. The saved transition rebuilds toward the original range without overwriting the prescription or treating fewer reps alone as failure. Impractical jumps stay at the current weight. A modest step may aim one rep above its estimate while staying inside the prescription.
  - Unspecified/AMRAP rep targets remain empty. Load increases require repeated improving performance at the same load (at least two sessions with effort, three without); the engine never treats these sets as having a one-rep ceiling. Recovery suggestions cannot exceed the current load.
  - Load/reps calculations are approximate starting points, bounded to 30 effective reps; they do not change PR calculations or guarantee an RIR. Suggestions remain frozen for the session, never pre-log a set, and preserve account-scoped history and bodyweight context.
  - `api/Domain/LoadOptions.cs` supplies fixed increments, uneven available-weight lists, bounds, and next/previous weights independently of progression. The service resolves account-specific exercise settings with the catalog/custom increment as the default. Edit these in the exercise library under **Weight settings**; the existing logged-weight convention is preserved.
  RPE decides the pace, a hard or missed session holds, and a lift that has not moved for two
  sessions is offered a lighter week. Strength is estimated with Epley extended by reps in
  reserve — a set is rated as if it had been carried to failure — and a set outside the range
  that equation holds produces no estimate rather than a misleading one. Every suggestion says
  in words why it changed, and a program's own reps and RPE are never overwritten.
- The Body tab shows completed working-set coverage by muscle for the last week, month, or three
  months. Each set credits its primary muscle fully and secondary muscles at half weight; fixed
  weekly bands keep the map colors consistent, and unresolved exercises are listed as unattributed.
- A rest timer that survives a locked phone: it is stored as a deadline rather than a countdown,
  the screen is held awake while it runs, and the end tone is queued on the audio clock ahead of
  time so it still sounds with the screen off. If the browser closes the app outright, the timer
  is still correct on return and reports what was missed.
- Programs run in phase order: finishing or explicitly skipping every training slot completes a
  phase, and the next Monday starts the following phase. The final phase moves the program to
  Completed; imported programs wait in Standby until scheduled and activated.
- A PDF program is read on the device: the browser extracts the text layer with pdf.js and posts
  only that text, gzipped, so a 70 MB illustrated training book never leaves the phone or laptop
  and no page image is ever sent to a model. Up to 1,000 pages are accepted. A first cheap pass
  reads a page-by-page view to find the pages that actually carry the schedule — commonly ten
  pages out of a hundred — and only those pages are read in full, one section at a time. Pages
  with no selectable text contribute nothing and are reported rather than guessed at; a scanned
  document has to be re-saved as a text PDF. The extracted text is held for 24 hours so an
  interrupted read continues, and is dropped as soon as the draft is complete.
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

## Deployment

See [deploy/README.md](deploy/README.md) for the Neon, Cloud Run, and Vercel setup, the exact
resource names, and how to load the exercise catalog.

### Personal exercise weights

Open an exercise in the library and choose **Edit weights**. Keep the default, set a fixed increment (0 means no load progression), or enter an uneven list of available weights. Settings belong to your account and follow that exercise across programs; they do not edit the shared catalog. Use the same load convention as your logs: per dumbbell, or total barbell/machine load.

**Settings → Weight unit** switches between kg and lb. Exercise settings use that unit and are stored in canonical kilograms. Saved weights are converted when the unit changes, not reinterpreted. Available-weight lists are sorted and deduplicated; manual logging remains free to record the actual load. New workouts and exercise swaps use these settings for progression, including added load and assistance; changing settings leaves existing workout drafts and completed history untouched. Choose **Default** and save to restore the exercise default. Concurrent edits are rejected with a reload action.
