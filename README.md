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

## What it does

- Username and password accounts, capped at two, with hashed sessions in a 30-day `HttpOnly`,
  `Secure`, `SameSite=Strict` cookie, origin and header CSRF checks, and per-address rate limits.
- Workouts built by hand, or imported from a training PDF by AI and corrected in a review screen
  before anything becomes a program.
- Set logging with weight, reps, and RPE; previous performance is prefilled but never pre-logged.
- Programs run in order: finishing a workout completes its slot and the next one is suggested.
- Kilograms are canonical; pounds are a display conversion.

## Data boundaries

Training data lives in the database and reaches the browser over HTTPS. Nothing about a workout
is written to `localStorage`, `sessionStorage`, IndexedDB, or a service-worker cache, so the app
needs a connection to log a set and says so plainly when it does not have one. The service worker
precaches the static shell only; API responses are `no-store` and never fall back to the SPA
document.

The exercise catalog is global and read-only to users: only the seed command writes it, and it
starts empty. Imported PDFs are read once and never stored — a failed import keeps its error, not
the document. A weight that was not recorded stays unknown and is left out of volume totals
rather than counted as zero; a zero weight is a real bodyweight set.

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
