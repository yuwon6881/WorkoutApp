# Workout

A workout tracker with an account-backed database and an AI program importer. One repository
holds the React PWA (`web/`) and the ASP.NET Core API (`api/`), following the same layout as the
sibling NutritionApp.

| Directory | What it is |
| --- | --- |
| `web/` | React 19 + Vite + TypeScript PWA, deployed to Vercel |
| `api/` | ASP.NET Core 10 minimal API on PostgreSQL (Neon), deployed to Cloud Run |
| `tests/` | xUnit tests for the API |
| `deploy/` | Deployment, seeding, and recovery notes |

## Run it locally

Requires Node 24 and .NET 10.

```powershell
cd api;  dotnet run                       # http://localhost:5183 with a local SQLite file
cd web;  npm ci;  npm run dev             # http://localhost:5182, proxying /api to the API
```

In development the API falls back to SQLite when no connection string is configured, so nothing
external is needed to work on the app. Point `WORKOUT_API` at another origin to proxy elsewhere.

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
- Progression: reps climb through the prescribed range, then the load moves and the reps reset.
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

Training data lives in the database and reaches the browser over HTTPS. Nothing about a workout
is written to `localStorage`, `sessionStorage`, IndexedDB, or a service-worker cache, so the app
needs a connection to log a set and says so plainly when it does not have one. The single
exception is the rest deadline, which is a device-local clock reading and carries no training
data. The service worker
precaches the static shell only; API responses are `no-store` and never fall back to the SPA
document.

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
```

The end-to-end suites run the real API against a disposable SQLite database and replace the AI
provider with a local stand-in, so an import can be exercised without a paid call. Playwright uses
installed Google Chrome; screenshots are written to the ignored `web/artifacts/` directory.

## Deployment

See [deploy/README.md](deploy/README.md) for the Neon, Cloud Run, and Vercel setup, the exact
resource names, and how to load the exercise catalog.
