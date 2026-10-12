# WorkoutApp redesign — implementation brief for Gemini

Redesign WorkoutApp’s web/PWA, Android phone interface, and native Wear OS companion from the ground up to match the composition and finish of the supplied FinancialApp reference. Reuse interaction primitives and application logic; rethink page structure, proportions, color palette, typeface, typography, density, and styling. Color and font changes are explicitly authorized; the current lime accent and Inter typeface are not fixed requirements.

## 1. Visual direction and references

Create a premium training workspace: FinancialApp’s restrained surfaces, alignment, compact navigation, and hierarchy, with training actions and anatomy as the focal points.

Published app screenshots were visually inspected:

- [Gentler Streak](https://developer.apple.com/news/?id=3m0ht22s), 2024 Apple Design Award winner: generous spacing, readable summaries, quiet navigation, supportive language.
- [SmartGym](https://smartgym.app/), [Apple Watch App of the Year 2023](https://www.apple.com/li/newsroom/2023/11/apple-unveils-app-store-award-winners-the-best-apps-and-games-of-2023/): dark exercise pages, prominent numbers, simple set rows, front/back anatomy.
- [Hevy](https://www.hevyapp.com/features/gym-progress/): calendar-to-session navigation, muscle-map-to-set-breakdown hierarchy, exercise history. A practical reference, not an award claim.

Translate these patterns into original WorkoutApp layouts using existing SVG assets. The FinancialApp image is visual reference only.

## 2. Establish one design system

- Choose a fresh, cohesive workout-specific palette and typeface before implementation. Use FinancialApp’s restrained contrast and hierarchy as reference, not its exact colors. Design dark and light palettes together; map them into existing semantic variables in `web/src/index.css` and the native watch theme. Preserve token meanings rather than existing hex values; do not scatter feature colors.
- Use three surface levels: canvas, card, input/popover. The implemented direction uses subtle borders, 12 px surface corners, 8 px control corners and 14 px dialogs. Compact library rows use 12–18 px padding; reserve larger padding for the workout hero. Reserve pills for navigation, filters, and short metadata.
- Reassess the typeface: keep Inter only if it suits the new design, or bundle a suitably licensed replacement with required weights and glyphs. Avoid runtime remote-font loading. Web starting scale: headings 32 px desktop/26 px phone, sections 18 px, body 14–16 px, essential labels at least 14 px, key numbers 36–44 px. Use tabular numbers; remove tiny essential labels. Adapt native watch typography separately in sp using Wear Material 3 roles.
- Use a 4/8/12/16/24/32 px spacing scale. Standardize heading/action baselines, icon sizing, input heights, badges, dividers, and dialog footers.
- The chosen accent signals the primary action, current set, selected anatomy, and actual progress. Normal navigation selection uses a neutral filled capsule with a restrained accent icon. Retune semantic effort/error colors for the new surfaces while preserving their meaning and accompanying labels; keep visible focus and correct on-accent text contrast.
- Motion: existing shared motion primitives, 120–240 ms, subtle transitions, reduced-motion support. Keep content cards solid; limit translucent treatment to floating navigation/session controls.

## 3. Recompose the shell

Keep Overview, Workouts, Muscles, and Exercises and their existing addresses/back behavior. Desktop: 220 px sidebar, compact brand, evenly spaced navigation, Ask AI and Settings below; remove the empty-looking topbar strip by integrating its actions/status into the page header. Content max-width 1200 px, 32 px desktop gutters. Medium layouts use the existing shell tier with adapted columns; phones use 16 px gutters and a refined four-item bottom dock. Respect existing <640/640–1023/≥1024 breakpoints. Keep the session mini-player above navigation without covering content.

## 4. Give every screen a deliberate composition

| Screen | Required redesign |
|---|---|
| Overview | One next-workout/resume hero: name, program/week, planned muscles, factual counts, Start/Resume. Desktop: hero and compact three-metric strip beside the calendar with completion in its header, then history. Phone: hero → calendar/completion → metrics → history. Include no-program/rest/finished states; avoid duplicate resume cards. |
| Workouts | Separate active slot and library. Active program: full-width week timeline, compact day rows, muscle previews. One trailing Create/Import toolbar. Consistent library title/metadata/preview/menu layout; preserve expand/drag/run behavior. |
| Active workout | Fixed-height elapsed/rest header → understated exercise strip → prominent exercise title → compact target/progression summary → aligned set rows → notes. Preserve phone one-line set/type, previous-or-target, load, reps/RIR-or-seconds, and completion. Current row: fine accent frame; logged row: muted fill/check. Retain options and conditional Finish footer; prevent timer layout shifts. |
| Muscles | Dominant front/back SVG plates beside ranked muscle rows on desktop; stacked on phone. Header period selector, quiet summary strip, stable selected-muscle detail area, body crops and lift links. Display recorded coverage accurately, without invented recovery scores. |
| Exercises | Aligned search/filter toolbar, category sections, text-first cards: readable title, primary/secondary muscles and category/equipment. Narrow cards place wrapping badges below a full-width title. Detail: large chart, compact records, separate History tab. |
| Builder/PDF review | Compact block/week timeline, orderly day rows, dedicated day dialogs with consistent exercise cards/prescription grids. Desktop notes beside prescriptions; phone stacked. Linked issue summary, persistent import progress/cancellation. |
| History/details | Dated rows: duration, working sets, record badges. Session detail: summary → muscle crops → expandable logged exercises. Preserve prefetch, deletion, and exercise drill-down. |
| Settings/AI/auth | Sectioned setting rows, consistent integration cards. AI: readable messages, anchored composer, evidence dates, distinct action-review cards. Apply the same system to sign-in, recovery, loading, empty, offline, and error states. |

## 5. Implement in this order

1. Read `CLAUDE.md`; inspect current source and Git status. Capture current 390/768/1440 px screens in both themes using disposable test data.
2. Define shared tokens and restyle existing `Button`, `Modal`, `Select`, `SegmentedControl`, `SettingRow`, `Skeleton`, and motion primitives. Avoid a parallel component system.
3. Rebuild `App.tsx`, shell styles, `Dashboard.tsx`, `TrainingCalendar`, and completion/summary layouts. Wire the hero to existing start/resume operations; retain lazy resource loading.
4. Redesign `Programs`, builder/import components, `Exercises`, `MuscleBalanceView`, `BodyMap`, and history/detail components.
5. Redesign `WorkoutTopBar`, `WorkoutActiveExercise`, `WorkoutSetRow`, `WorkoutRestBar`, `WorkoutSheet`, and their styles; finish Settings/AI/auth surfaces. Consolidate superseded CSS instead of adding another override layer.
6. Redesign the native `wear/` Compose UI using section 6. Record the starting commit SHA and preserve unrelated changes so the final diff can be reviewed.

Preserve server authority, DTOs, progression, revision/idempotency, offline queues/recovery, timers, timed/bodyweight modes, supersets, RIR visibility, PDF provenance, and scope confirmations. Keep primary/full and secondary/half muscle credits, unknown values, and skip-versus-completion semantics. Reuse current data; introduce no invented scores or backend changes for decorative UI.

## 6. Wear OS companion — required scope

Use [Google’s wearable design guidance](https://developer.android.com/design/ui/wear/guides/get-started/design-for-wearables) and [adaptive-layout guidance](https://developer.android.com/design/ui/wear/guides/foundations/adaptive-design): round-first composition and glanceable actions. This is a native Kotlin/Compose redesign, not a scaled phone screen.

- **Theme/type:** true-black canvas, restrained raised surfaces, the redesigned product accent and semantic effort colors. Rework `ui/theme/WearWorkoutTheme.kt`; use readable Wear typography, tabular timers/loads, and system font scaling. Evaluate any custom font on the watch before applying it. Use native dp/sp rather than web px; retain Material component touch targets, targeting ≥48 dp for ordinary controls.
- **Set page:** exercise name with stable two-line allowance, set/type context, prominent reps-or-seconds and load, secondary previous/target evidence, optional RIR, one edge action to Log or Start/Stop the timed set. Clearly mark the crown-selected field; tapping opens the same value editor. Keep Undo accessible; distinguish warm-up, weighted/assisted/loadless, timed, and RIR-off layouts.
- **Rest page:** dominant countdown inside a thin perimeter progress ring, next-set context below, quiet −15/+15 controls, and edge Skip action. Use fixed positions across resting/rest-complete/paused states. Avoid perpetual decorative animations and extra vibration effects.
- **Overview:** elapsed time and logged-set progress first, compact exercise jump list, clear pause/resume, secondary sync status, and existing guarded Finish action. Retain the current two-page navigation: Now switches between set/rest, with Overview alongside; preserve system swipe-back and crown scrolling/editing.
- **Supporting screens:** redesign pairing/code expiry, waiting for a phone/web workout, value editors, finish/disconnect confirmations, pending finish, connection errors, notification permission guidance, and same-set/finish conflict review. Queued data must not look server-confirmed. Align ongoing-activity/notification iconography and short labels with the new identity.
- **Implementation:** reuse `WearComponents.kt`, `ValueControls.kt`, and native Material 3 primitives; update `SetPage.kt`, `RestPage.kt`, `OverviewPage.kt`, `ActiveWorkoutScreen.kt`, `PairingScreen.kt`, `StatusScreens.kt`, `Dialogs.kt`, and `ConflictReview.kt`. Preserve account pairing, ordered replay, revisions, timer persistence, alert generations, background service behavior, and independent watch vibration/phone sound.

## 7. Acceptance and delivery

- Follow [Apple’s layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout): clear hierarchy, deliberate alignment, adaptable composition, and safe areas. Use shared tokens consistently as described by [Material Design](https://m3.material.io/foundations/).
- Verify both themes at 390/768/1440 px and the existing 320–1920 px responsive matrix, 200% zoom, keyboard operation, focus restoration, long titles, empty/loading/offline/error states, and Android keyboard/safe-area behavior. Maintain ≥44 px compact/medium hit targets and ≥4.5:1 normal-text contrast; see [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The 44 px app target exceeds [WCAG 2.2’s 24 px AA minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Exercise start → log/edit → rest → pause/resume → minimize/reopen → finish, plus swap/restore, timed/bodyweight sets, RIR-off, import review, and day editing. Use disposable API/database fixtures.
- Run repository documentation/standards checks, typecheck, unit tests, build, visual and responsive suites. Update affected visual expectations only after inspecting screenshots. Keep skeletons matched to final layouts and retain demand-loaded views.
- Wear: from `wear/`, run `./gradlew.bat :app:testDebugUnitTest :app:assembleDebug`. Inspect generated `WearScreenshotTest` images for every existing small-round/large-round/square/font-scale configuration; add missing timed/RIR-off/long-title coverage. The current screenshot test proves rendering, not freedom from clipping. Verify real emulator touch/crown/back interactions and a disposable paired workflow: log/undo → rest/adjust/skip → pause/resume → offline queue/reconnect → guarded finish; include concurrent phone edits/conflict review. Report physical-watch vibration, background timing, and battery behavior as unverified unless actually tested.
- Deliver before/after screenshots for every major screen at phone and desktop sizes in both themes, plus a concise change/test report. Update implemented documentation after implementation and run `node scripts/sync-docs.mjs` and `--check`. Do not commit, push, or deploy unless requested.
- Review handoff for Codex: leave changes reviewable; provide baseline commit, changed-file summary, palette/font decisions and font license, web/phone/watch screenshot locations, exact checks with pass/fail/skipped status, and known gaps. Codex will review the diff, visual consistency, accessibility, performance, and action-to-persistence/sync behavior when Gemini is finished.

## 8. Fresh implementation pass — 11 October 2026

The user rejected the previous cosmetic redesign. The current implementation contract is [FRESH_DESIGN_CONTRACT.md](artifacts/redesign-review/FRESH_DESIGN_CONTRACT.md). Gemini implements application code through separate, bounded `agy` conversations; Codex coordinates, reviews the diffs and actual rendered results, and runs verification. Preserve unrelated work; no commit, push or deployment.

- Replace neon lime/Inter with restrained warm charcoal/jade dark, off-white/deep-jade light and self-hosted Manrope Variable. Manrope is licensed under [SIL OFL 1.1](https://fontsource.org/fonts/manrope/about); retain font attribution. Native Wear retains its platform typography on true black with the shared jade accent.
- Recompose Overview: workout hero and an unboxed metric strip in the primary desktop column; compact weekly calendar/completion in the secondary column; quieter history below. Update shell and skeletons together, remove ornamental status/icon pills, and retain authoritative unknown/completed/active-slot data semantics.
- Recompose Workouts around a clear active region and compact library, align exercise search/filters and rows, center Muscles on the data visualization, and simplify logger/header chrome. Preserve every input, action, drag/keyboard path, timer and persistence contract.
- No emoji in application-owned UI. Keep icons only when they convey an action, navigation, useful status or actual data. Shorten copy without deleting units, uncertainty, destructive outcomes or offline/sync/conflict facts.
- Independently inspect both themes and widths 320–1920, long titles, menus/sheets, touch targets, text sizes and overlap. Wear must keep Continue/Resume readable on square180/round192 at 1.3 font scale with 48dp adjustment controls.

### Verification boundaries

The preceding implementation passed 1,236 API tests, 667 frontend unit tests, 76 Wear tests, a debug APK, 58 responsive tests and 111 full browser tests with two intentional Settings-navigation skips. These are baseline results, not verification of the new design pass. Final results and screenshot paths must be refreshed in [REVIEW_REPORT.md](artifacts/redesign-review/REVIEW_REPORT.md).

Physical-device/native crown and pairing workflows, native keyboard/safe areas, background watch timing/vibration/battery, real external providers and production deployment remain unverified unless separately exercised. Windows screenshot expectations do not prove Linux rendering. Do not claim all possible screen widths or full native acceptance from sampled geometry/render checks.

### Implemented Gemini repairs and review gates

The user restored Gemini quota and requested immediate continuation. The 1:01 p.m. reminder was deleted. Bounded `agy` conversations implemented the repairs; Codex reviewed source, rendered geometry and test results.

- Narrow exercise cards now use a container query at 380 px card width: the title gets a full-width first row and badges wrap beneath it. Selectors explicitly outrank legacy shared styles loaded later. Preserve the wider title/badge row, catalog metadata and pointer/keyboard/picker behavior. The rebuilt preview confirms readable titles at 320/640/768 px.
- Phone main gutters are 16 px, with 4 px compact calendar padding. At 360 px including a 10 px scrollbar, the current-week rail spans x21–329 and contains all seven 44 px targets. The 320 px rail intentionally scrolls; never shrink targets to force a fit.
- Light faint text uses `#58635b`; all 26 audited theme text/surface pairs pass. This token audit does not establish complete accessibility for blended, error, effort or chart colors.
- Wear's value-editor title is `RIR`; reconnect status is `Reconnect`. The screenshot fixture matches the actual screen. Target captions, bounds, crown handlers and synchronization semantics remain. Latest tests: 76 passed, no failures/errors/skips; debug APK built. Enlarged-text round/square renders inspected.
- Hero tests retain behavior assertions and now expect the concise source wording. Latest frontend suite: 686 passed, no failures/skips, across 110 files. Typecheck and production/PWA build pass; the final CSS specificity repair was rebuilt afterward.
- Tablet/desktop shell no longer duplicates Ask AI/Settings controls in its top bar; phone actions remain. The reserved status strip is 36 px from 640 px upward and 68 px on phones. Settings headings lose ornamental icons; functional navigation remains. Tablet anchor selection focuses a visible heading below the sticky nav. Finished active slots show `Completed` instead of repeating the workout name, with the name retained in the accessible status.
- Native Android launch/offline/notification colors and PWA manifest colors now match charcoal/jade. Phone tests: 36 passed, no failures/errors/skips; debug APK built with the final web index, Manrope assets and OFL license. Preserve launcher foreground artwork, routing and native permissions. APK packaging does not prove native or physical-device interactions.
- Supplemental responsive fixtures now support widths outside the original seven without an undefined Nutrition summary. Original fixture selections and assertions are preserved. Finished-slot workflow checks the named completed status and visible `Completed` label while retaining Restart/Move verification.

Final responsive and browser outcomes, screenshots, exact skipped cases and native-device limits are recorded in [REVIEW_REPORT.md](artifacts/redesign-review/REVIEW_REPORT.md). Do not weaken assertions or claim all possible widths, real-provider workflows, or physical/native acceptance from sampled web geometry and static Wear renders.

## Final review repair gates

- Slot mutations must await the refreshed program and template resources before allowing another slot action. Moving a progressed program to the library must leave an empty slot; activating the next workout must not ask to replace the departed program. Genuine progress replacement still requires confirmation, and failed changes retain explicit recovery.
- Keep E2E account cleanup on a neutral same-origin document so mounted workout effects cannot rewrite the account-scoped recovery record during direct fixture cleanup. Retain all logging, history, replacement, Restart and Move assertions.
- Keep shared Overview layout CSS eagerly loaded in its original cascade order and theme/native status-bar synchronization in one focused hook. Source files must remain below the repository size limit.
- Final acceptance requires the complete browser suite on the final production bundle, renewed responsive checks after the last source change, and updated phone APK assets. Earlier passes remain historical evidence until these final gates complete. Physical-device and native Wear interaction checks remain separate and unverified.

Implemented dev/build parity repair: obsolete desktop/tablet floating-dock shell overrides were removed from BottomNav.css. The actual Vite dev view must use the same flat full-height sidebar and bottom-pinned utilities as production, with mobile navigation retained. Verify rendered parity at 640/768/1024/1440 plus both themes; do not accept production screenshots alone.

## Reviewed handoff — final local checks

The fresh design is implemented: Manrope/jade themes, flat full-height desktop/tablet navigation, recomposed Overview, compact workout rows, responsive title-first exercise cards and quieter muscle/settings screens. Functional icons remain; application-owned emoji decoration is removed. Native Wear keeps true black and platform typography.

Slot actions now wait for a forced canonical program/template refresh; overlapping mutations remain guarded. Dev optional CSS shares production insertion order, closed dialogs are hidden, and artifact generation no longer reloads the dev view. Preserve these repairs in future edits.

The current build passes TypeScript/PWA generation and 686 frontend tests. Phone APK contains the exact current index, five Manrope assets and OFL license; 36 Android tests pass. Wear's 76-test/APK/render result remains current for unchanged native source. Exact browser and responsive acceptance, original failures and focused reruns are in [REVIEW_REPORT.md](artifacts/redesign-review/REVIEW_REPORT.md); do not replace its counts with an assumed full-suite pass.

Remaining device acceptance requires actual Wear touch/crown/back, pairing/offline/conflict and background-alert workflows, plus Android keyboard/safe-area checks and 200% zoom. Static renders and web viewport checks do not close those gates. No commit, push or deployment is authorized.

Final responsive acceptance: 58 passed at the seven 320–1920 px widths and 18 passed at 360/1280 px, both themes, no failures/skips. Desktop repair rerun: 22 passed, including all refreshed loading snapshots and previously blocked cases. The complete-run history and setup counts remain explicit in the report; no all-113-pass claim is made.
