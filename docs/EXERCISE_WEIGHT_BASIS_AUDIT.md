# Exercise weight-entry audit

Audited before implementation against all 423 entries in `deploy/exercises.json` on 2026-10-15.

Classification: 84 per side; 339 total. All rows receive explicit metadata; no runtime equipment/name guessing.

Per side means the entered load belongs to one independently loaded side or dumbbell. Total means the full shared implement, machine load or selected stack. A single-arm cable or machine movement uses its one selected stack as total. Machine chest press and leg press remain total, including plate-loaded versions. Dumbbell goblet squats, hip thrusts, pullovers and two-hand overhead/French extensions use one shared dumbbell and remain total.

This is an input convention, not a count of implements or repetitions. Stored weights, progression, personal records and volume retain their existing numeric scale (recorded load times reps); this change does not double volume or reinterpret historical numbers. Earlier entries may have used either convention and are not automatically converted. Custom movements choose explicitly; existing custom movements default to total.

## Validation (2026-10-15)

- API: 1,469 passed on the final full run. An earlier full run had one five-second importer wait fail; that test passed separately and the full rerun passed. Five new regressions cover explicit catalog metadata, actual migration backfill, custom persistence and tenancy, session swap/restore/history without numeric rescaling, and retained catalog identities. Ask AI's custom catalog/progression metadata is also asserted.
- Frontend: 831 tests across 133 files passed; typecheck and production build passed.
- Wear: all 14 `ActiveWorkoutModelTest` tests passed, including per-side tile and editor captions.
- Full visual suite: 144 passed, 2 skipped. Full responsive suite: all 93 passed across 320, 390, 640, 768, 1024, 1440 and 1920 px. The new flow creates a custom exercise through the UI, verifies the persisted choice, and checks per-side versus total workout headings in both themes and both units. The 320 px and phone screenshots were inspected directly.
- PostgreSQL migration SQL generation, EF pending-model check, documentation equality, repository standards and `git diff --check` passed. The migration's backfill SQL was executed against every shipped catalog row in an isolated SQLite regression.
- Tests use disposable local data and a mock identity/provider environment. Production data and PostgreSQL execution, live sign-in/providers, physical Android/Wear devices and deployment remain unverified. No commit, push or deployment was performed.

## Complete classification

| Slug | Exercise | Equipment | Weight entry | Reason |
| --- | --- | --- | --- | --- |
| air-squat | Air Squat | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| back-squat | Back Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| high-bar-back-squat | High-Bar Back Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| low-bar-back-squat | Low-Bar Back Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pause-squat | Pause Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| wide-stance-back-squat | Wide Stance Back Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| front-squat | Front Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| hack-squat | Hack Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pause-hack-squat | Pause Hack Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| leg-press | Plate-Loaded Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-press | Weight-Stack Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| constant-tension-leg-press | Plate-Loaded Constant-Tension Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-constant-tension-leg-press | Weight-Stack Constant-Tension Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-leg-leg-press | Plate-Loaded Single-Leg Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-single-leg-leg-press | Weight-Stack Single-Leg Leg Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-squat | Smith Machine Squat | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| belt-squat | Belt Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pendulum-squat | Pendulum Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| goblet-squat | Goblet Squat | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| dumbbell-walking-lunge | Dumbbell Walking Lunge | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| smith-machine-lunge | Smith Machine Lunge | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-reverse-lunge | Smith Machine Reverse Lunge | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-lunge | DB Lunge | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| barbell-lunge | Barbell Lunge | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-bulgarian-split-squat | DB Bulgarian Split Squat | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| pause-db-bulgarian-split-squat | Pause DB Bulgarian Split Squat | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| walking-lunge | Walking Lunge | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| leg-extension | Plate-Loaded Leg Extension | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-extension | Weight-Stack Leg Extension | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| unilateral-eccentric-overloaded-leg-extension | Unilateral Eccentric-Overloaded Leg Extension | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dumbbell-step-up | Dumbbell Step-Up | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| reverse-nordic | Reverse Nordic | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| sissy-squat | Sissy Squat | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| deadlift | Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pause-deadlift | Pause Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| trap-bar-deadlift | Trap Bar Deadlift | Trap Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| romanian-deadlift | Romanian Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-romanian-deadlift | DB Romanian Deadlift | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| barbell-rdl | Barbell RDL | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| snatch-grip-rdl | Snatch-Grip RDL | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| stiff-leg-deadlift | Stiff Leg Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| eccentric-accentuated-stiff-leg-deadlift | Eccentric-Accentuated Stiff-Leg Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| good-morning | Good Morning | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-hip-thrust | Barbell Hip Thrust | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-hip-thrust | Plate-Loaded Machine Hip Thrust | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-hip-thrust | Weight-Stack Machine Hip Thrust | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-leg-db-hip-thrust | Single-Leg DB Hip Thrust | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| 45-hyperextension | 45° Hyperextension | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| seated-hamstring-curl | Plate-Loaded Seated Hamstring Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-seated-hamstring-curl | Weight-Stack Seated Hamstring Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lying-leg-curl | Plate-Loaded Lying Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-lying-leg-curl | Weight-Stack Lying Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| constant-tension-lying-leg-curl | Plate-Loaded Constant-Tension Lying Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-constant-tension-lying-leg-curl | Weight-Stack Constant-Tension Lying Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| swiss-ball-leg-curl | Swiss Ball Leg Curl | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| standing-cable-leg-curl | Standing Cable Leg Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| sliding-leg-curl | Sliding Leg Curl | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| glute-ham-raise | Glute Ham Raise | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| nordic-ham-curl | Nordic Ham Curl | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| seated-leg-curl | Plate-Loaded Seated Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-seated-leg-curl | Weight-Stack Seated Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-pull-through | Cable Pull-Through | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| glute-kickback | Plate-Loaded Glute Kickback | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-glute-kickback | Weight-Stack Glute Kickback | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-cable-deadlift | Seated Cable Deadlift | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| flat-db-press | Flat DB Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| flat-dumbbell-static-hold | Flat Dumbbell Static Hold | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| flat-machine-chest-press | Plate-Loaded Flat Machine Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-flat-machine-chest-press | Weight-Stack Flat Machine Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-chest-press | Plate-Loaded Seated Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-seated-chest-press | Weight-Stack Seated Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-machine-press | Plate-Loaded Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-incline-machine-press | Weight-Stack Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-smith-machine-press | Incline Smith Machine Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-incline-press | Barbell Incline Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| bench-press | Bench Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| larsen-press | Larsen Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-bench-press | DB Bench Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| machine-chest-press | Plate-Loaded Machine Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-chest-press | Weight-Stack Machine Chest Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-barbell-incline-press | Close-Grip Barbell Incline Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-db-incline-press | Close-Grip DB Incline Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| close-grip-machine-press | Plate-Loaded Close-Grip Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-close-grip-machine-press | Weight-Stack Close-Grip Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| press-around | Press-Around | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-flye | DB Flye | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| deficit-push-up | Deficit Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| low-incline-db-press | Low Incline DB Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| low-incline-machine-press | Plate-Loaded Low Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-low-incline-machine-press | Weight-Stack Low Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| low-incline-smith-machine-press | Low Incline Smith Machine Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dumbbell-chest-press | Dumbbell Chest Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-chest-press | Cable Chest Press | Cable | Per side | Independent left/right cable loads; enter one side. |
| weighted-dip | Weighted Dip | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| dip | Dip | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| assisted-dip | Assisted Dip | Machine | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| push-up | Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| close-grip-push-up | Close-Grip Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| incline-close-grip-push-up | Incline Close-Grip Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| kneeling-modified-push-up | Kneeling Modified Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| 45-incline-barbell-press | 45° Incline Barbell Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 45-incline-db-press | 45° Incline DB Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| 45-incline-machine-press | Plate-Loaded 45° Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-45-incline-machine-press | Weight-Stack 45° Incline Machine Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dumbbell-floor-press | Dumbbell Floor Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| pause-barbell-bench-press | Pause Barbell Bench Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| strict-bench-press | Strict Bench Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-bench-press | Close-Grip Bench Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-smith-machine-press | Close-Grip Smith Machine Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-bench-press | Smith Machine Bench Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| low-to-high-cable-flye | Low To High Cable Flye | Cable | Per side | Independent left/right cable loads; enter one side. |
| cable-flye-21s | Cable Flye 21s | Cable | Per side | Independent left/right cable loads; enter one side. |
| cable-flye | Cable Flye | Cable | Per side | Independent left/right cable loads; enter one side. |
| pec-deck | Plate-Loaded Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-pec-deck | Weight-Stack Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| bent-over-cable-pec-flye | Bent-Over Cable Pec Flye | Cable | Per side | Independent left/right cable loads; enter one side. |
| cable-crossover-ladder | Cable Crossover Ladder | Cable | Per side | Independent left/right cable loads; enter one side. |
| bottom-half-db-flye | Bottom-Half DB Flye | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| low-incline-db-flye | Low Incline DB Flye | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| low-to-high-cable-crossover | Low-To-High Cable Crossover | Cable | Per side | Independent left/right cable loads; enter one side. |
| 2-grip-lat-pulldown | 2-Grip Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 2-grip-pull-up | 2-Grip Pull-up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| machine-pulldown | Plate-Loaded Machine Pulldown | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-pulldown | Weight-Stack Machine Pulldown | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| t-bar-row | T-Bar Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-seated-elbows-out-row | Cable Seated Elbows-Out Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-high-row | Plate-Loaded Machine High Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-high-row | Weight-Stack Machine High Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seal-row | Seal Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| helms-db-row | Helms DB Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| chest-supported-machine-row | Plate-Loaded Chest-Supported Machine Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-chest-supported-machine-row | Weight-Stack Chest-Supported Machine Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-cable-row | Seated Cable Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-chest-supported-db-row | Incline Chest-Supported DB Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| chest-supported-t-bar-row | Chest-Supported T-Bar Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lat-pulldown | Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pull-up | Pull-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| assisted-pull-up | Assisted Pull-Up | Machine | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| 1-arm-half-kneeling-lat-pulldown | 1-Arm Half-Kneeling Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 1-arm-lat-pull-in | 1-Arm Lat Pull-In | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weighted-pull-up | Weighted Pull-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| neutral-grip-pullup | Neutral-Grip Pullup | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| pendlay-row | Pendlay Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-bent-over-row | Barbell Bent Over Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| omni-grip-machine-chest-supported-row | Plate-Loaded Omni-Grip Machine Chest-Supported Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-omni-grip-machine-chest-supported-row | Weight-Stack Omni-Grip Machine Chest-Supported Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| kroc-row | Kroc Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| single-arm-db-row | Single-Arm DB Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| meadows-row | Meadows Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pronated-pulldown | Pronated Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| humble-row | Humble Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| wide-grip-pull-up | Wide-Grip Pull-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| cable-close-grip-row | Cable Close-Grip Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-chest-supported-row-w-band | Plate-Loaded Machine Chest-Supported Row W/Band | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-chest-supported-row-w-band | Weight-Stack Machine Chest-Supported Row W/Band | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| negative-neutral-grip-pull-up | Negative Neutral-Grip Pull-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| seated-t-bar-row | Seated T-Bar Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| wide-grip-lat-pulldown | Wide-Grip Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 1-arm-cable-pulldown | 1-Arm Cable Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-lat-pulldown | Close-Grip Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| close-grip-pull-up | Close-Grip Pull-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| chest-supported-db-row | Chest-Supported DB Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| chest-supported-row | Plate-Loaded Chest-Supported Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-chest-supported-row | Weight-Stack Chest-Supported Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| neutral-grip-pulldown | Neutral Grip Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| bicep-grip-lat-pulldown | Bicep Grip Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dual-handle-lat-pulldown | Dual-Handle Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pendlay-deficit-row | Pendlay Deficit Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-deficit-row | Smith Machine Deficit Row | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-row | Smith Machine Row | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| moto-row | Moto Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cross-body-lat-pull-around | Cross-Body Lat Pull-Around | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-lat-prayer | Cable Lat Prayer | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lat-focused-cable-row | Lat-Focused Cable Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| elbows-in-1-arm-db-row | Elbows-In 1-Arm DB Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-lat-pullover | Cable Lat Pullover | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-lat-pullover | DB Lat Pullover | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| bottom-half-db-lat-pullover | Bottom-Half DB Lat Pullover | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| lat-pullover | Lat Pullover | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-pull-over | Cable Pull-Over | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-lat-pullover | Plate-Loaded Machine Lat Pullover | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-lat-pullover | Weight-Stack Machine Lat Pullover | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-pullover | Plate-Loaded Machine Pullover | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-pullover | Weight-Stack Machine Pullover | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-pullover | DB Pullover | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| machine-shoulder-press | Plate-Loaded Machine Shoulder Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-shoulder-press | Weight-Stack Machine Shoulder Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| push-press | Push Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| standing-db-arnold-press | Standing DB Arnold Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| seated-db-shoulder-press | Seated DB Shoulder Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| constant-tension-machine-shoulder-press | Plate-Loaded Constant-Tension Machine Shoulder Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-constant-tension-machine-shoulder-press | Weight-Stack Constant-Tension Machine Shoulder Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| arnold-press | Arnold Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| overhead-press | Overhead Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-curl | DB Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| single-arm-cable-curl | Single-Arm Cable Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-pronated-curl | DB Pronated Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-ez-curl | Cable EZ Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| ez-bar-curl | EZ-Bar Curl | EZ-Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-bicep-curl | DB Bicep Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| alternating-db-curl | Alternating DB Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| supinated-dumbbell-curl | Supinated Dumbbell Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| bayesian-cable-curl | Bayesian Cable Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| hammer-curl | Hammer Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| incline-dumbbell-curl | Incline Dumbbell Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| ez-bar-strict-curl | EZ-Bar Strict Curl | EZ-Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| ez-bar-preacher-curl | EZ-Bar Preacher Curl | EZ-Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-preacher-curl | Plate-Loaded Machine Preacher Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-preacher-curl | Weight-Stack Machine Preacher Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-preacher-curl | DB Preacher Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| heavy-barbell-hold | Heavy Barbell Hold | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| bench-braced-wrist-curl | Bench-Braced Wrist Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| dumbbell-wrist-curl | DB Wrist Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| behind-the-back-wrist-curl | Behind-the-Back Wrist Curl | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| bench-braced-wrist-extension | Bench-Braced Wrist Extension | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| dumbbell-wrist-extension | DB Wrist Extension | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| modified-zottman-curl | Modified Zottman Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| standing-wrist-extension | Standing Wrist Extension | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| farmer-s-walk | Farmer's Walk | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| plate-pinch | Plate Pinch | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| triceps-machine | Triceps Machine | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| overhead-cable-triceps-extension | Overhead Cable Triceps Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-arm-rope-triceps-extension | Single-Arm Rope Triceps Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-french-press | DB French Press | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| ez-bar-skull-crusher | EZ-Bar Skull Crusher | EZ-Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-skull-crusher | DB Skull Crusher | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| triceps-pressdown | Triceps Pressdown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| katana-triceps-extension | Katana Triceps Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| triceps-diverging-pressdown | Triceps Diverging Pressdown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dual-cable-triceps-press | Dual-Cable Triceps Press | Cable | Per side | Independent left/right cable loads; enter one side. |
| cable-triceps-kickback | Cable Triceps Kickback | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-triceps-kickback | DB Triceps Kickback | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| n1-style-cross-body-triceps-extension | N1-Style Cross-Body Triceps Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-arm-tricep-pressdown | Single-Arm Tricep Pressdown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-arm-cable-tricep-kickback | Single-Arm Cable Tricep Kickback | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| squeeze-only-triceps-pressdown | Squeeze-Only Triceps Pressdown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| stretch-only-overhead-triceps-extension | Stretch-Only Overhead Triceps Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| floor-skull-crusher-heavy | Floor Skull Crusher (Heavy) | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-floor-skull-crusher | DB Floor Skull Crusher | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| myo-reps-floor-skull-crusher | Myo Reps Floor Skull Crusher | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| tricep-pushdown | Tricep Pushdown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-jm-press | Smith Machine JM Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| overhead-cable-triceps-extension-bar | Overhead Cable Triceps Extension (Bar) | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| overhead-cable-triceps-extension-rope | Overhead Cable Triceps Extension (Rope) | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-lateral-raise | DB Lateral Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-lateral-raise | Cable Lateral Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-lateral-raise | Plate-Loaded Machine Lateral Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-lateral-raise | Weight-Stack Machine Lateral Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-db-y-raise | Incline DB Y-Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-y-raise | Cable Y-Raise | Cable | Per side | Independent left/right cable loads; enter one side. |
| cross-body-cable-y-raise-side-delt | Cross-Body Cable Y-Raise (Side Delt) | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| omni-direction-face-pull | Omni-Direction Face Pull | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| reverse-cable-flye | Reverse Cable Flye | Cable | Per side | Independent left/right cable loads; enter one side. |
| bent-over-reverse-db-flye | Bent-Over Reverse DB Flye | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| rope-face-pull | Rope Face Pull | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| high-cable-lateral-raise | High-Cable Lateral Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 1-arm-reverse-pec-deck | Plate-Loaded 1-Arm Reverse Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-1-arm-reverse-pec-deck | Weight-Stack 1-Arm Reverse Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lying-reverse-db-flye | Lying Reverse DB Flye | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| reverse-cable-crossover | Reverse Cable Crossover | Cable | Per side | Independent left/right cable loads; enter one side. |
| rear-delt-fly | Rear Delt Fly | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| rear-delt-45-cable-flye | Rear Delt 45° Cable Flye | Cable | Per side | Independent left/right cable loads; enter one side. |
| high-cable-cuffed-lateral-raise | High-Cable Cuffed Lateral Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lean-in-db-lateral-raise | Lean-In DB Lateral Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| meadows-incline-db-lateral-raise | Meadows Incline DB Lateral Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-unilateral-face-pull | Cable Unilateral Face Pull | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cuffed-behind-the-back-lateral-raise | Cuffed Behind-The-Back Lateral Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lying-paused-rope-face-pull | Lying Paused Rope Face Pull | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| standing-calf-raise | Plate-Loaded Standing Calf Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-standing-calf-raise | Weight-Stack Standing Calf Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-calf-raise | Plate-Loaded Seated Calf Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-seated-calf-raise | Weight-Stack Seated Calf Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| leg-press-toe-press | Plate-Loaded Leg Press Toe Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-press-toe-press | Weight-Stack Leg Press Toe Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| leg-press-calf-press | Plate-Loaded Leg Press Calf Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-press-calf-press | Weight-Stack Leg Press Calf Press | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| leg-press-calf-jumps | Plate-Loaded Leg Press Calf Jumps | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-press-calf-jumps | Weight-Stack Leg Press Calf Jumps | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-calf-jumps | DB Calf Jumps | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| donkey-calf-raise | Donkey Calf Raise | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| single-leg-db-calf-raise | Single-Leg DB Calf Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| calf-raise-machine | Plate-Loaded Calf Raise Machine | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-calf-raise-machine | Weight-Stack Calf Raise Machine | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-hip-abduction | Seated Hip Abduction | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-hip-abduction | Machine Hip Abduction | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-hip-abduction | Cable Hip Abduction | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| standing-plate-abduction | Standing Plate Abduction | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| lateral-band-walk | Lateral Band Walk | Band | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| hex-bar-shrug | Hex Bar Shrug | Trap Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| smith-machine-shrug | Smith Machine Shrug | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dumbbell-shrug | Dumbbell Shrug | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| barbell-shrug | Barbell Shrug | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-shrug-in | Cable Shrug-In | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-shrug | Plate-Loaded Machine Shrug | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-shrug | Weight-Stack Machine Shrug | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| kelso-shrug | Kelso Shrug | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| seated-cable-kelso-shrug | Seated Cable Kelso Shrug | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-db-kelso-shrug | Incline DB Kelso Shrug | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| trap-bar-shrug | Trap Bar Shrug | Trap Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-dumbbell-shrug | Seated Dumbbell Shrug | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-crunch | Cable Crunch | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-crunch | Plate-Loaded Machine Crunch | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-crunch | Weight-Stack Machine Crunch | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plate-weighted-crunch | Plate-Weighted Crunch | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| decline-plate-weighted-crunch | Decline Plate-Weighted Crunch | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| hanging-leg-raise | Hanging Leg Raise | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| roman-chair-crunch | Roman Chair Crunch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| reverse-crunch | Reverse Crunch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| bicycle-crunch | Bicycle Crunch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| weighted-crunch | Weighted Crunch | Bodyweight | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dragon-flag | Dragon Flag | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| bent-knee-dragon-flag | Bent-Knee Dragon Flag | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| lying-leg-raise | Lying Leg Raise | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| copenhagen-hip-adduction | Copenhagen Hip Adduction | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| cable-hip-adduction | Cable Hip Adduction | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-hip-adduction | Machine Hip Adduction | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| head-harness-neck-curl | Head Harness Neck Curl | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| head-harness-neck-extension | Head Harness Neck Extension | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plate-loaded-neck-curl | Plate-Loaded Neck Curl | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plate-loaded-neck-extension | Plate-Loaded Neck Extension | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dead-hang | Dead Hang | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| db-incline-press | DB Incline Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| deficit-deadlift | Deficit Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| leg-curl | Plate-Loaded Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-leg-curl | Weight-Stack Leg Curl | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dumbbell-row | Dumbbell Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| barbell-supinated-row | Barbell Supinated Row | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-upright-row | Cable Upright Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-floor-press | Barbell Floor Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| california-press | California Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| band-pull-apart | Band Pull-Apart | Band | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| reverse-hyper | Reverse Hyper | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plank | Plank | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| crunch | Crunch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| ab-wheel-rollout | Ab Wheel Rollout | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| diamond-push-up | Diamond Push Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| med-ball-close-grip-push-up | Med-Ball Close Grip Push Up | Medicine Ball | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| corpse-crunch | Corpse Crunch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| llpt-plank | LLPT Plank | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| roman-chair-leg-raise | Roman Chair Leg Raise | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| plate-front-raise | Plate Front Raise | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| egyptian-cable-lateral-raise | Egyptian Cable Lateral Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| reverse-pec-deck | Plate-Loaded Reverse Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-reverse-pec-deck | Weight-Stack Reverse Pec Deck | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-low-row | Plate-Loaded Machine Low Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-low-row | Weight-Stack Machine Low Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| wide-grip-cable-row | Wide-Grip Cable Row | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| omni-grip-lat-pulldown | Omni-Grip Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| n1-style-cross-body-cable-bicep-curl | N1-Style Cross-Body Cable Bicep Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pec-static-stretch | Pec Static Stretch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| lat-static-stretch | Lat Static Stretch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| side-delt-static-stretch | Side Delt Static Stretch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| bicep-static-stretch | Bicep Static Stretch | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| spider-curl | Spider Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-shoulder-press | Cable Shoulder Press | Cable | Per side | Independent left/right cable loads; enter one side. |
| machine-squat | Plate-Loaded Machine Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-squat | Weight-Stack Machine Squat | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| dead-bug | Dead Bug | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| zottman-curl | Zottman Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| anderson-squat | Anderson Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| pin-squat | Pin Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-box-squat | Barbell Box Squat | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| touch-and-go-deadlift | Touch-and-Go Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| reset-deadlift | Reset Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| opposite-stance-deadlift | Opposite Stance Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| block-pull | Block Pull | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| chin-up | Chin-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| assisted-chin-up | Assisted Chin-Up | Machine | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| db-concentration-curl | DB Concentration Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| ez-bar-reverse-curl | EZ-Bar Reverse Curl | EZ-Bar | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-reverse-curl | Barbell Reverse Curl | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plate-shrug | Plate Shrug | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-shrug | Incline Shrug | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| v-sit-up | V Sit-Up | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| l-sit-hold | L-Sit Hold | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| wall-slide | Wall Slide | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| squat-walk-out | Squat Walk-Out | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| neck-flexion-extension | Neck Flexion/Extension | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| barbell-isometric-hold | Barbell Isometric Hold | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-external-rotation | Cable External Rotation | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| incline-dumbbell-lateral-hold | Incline Dumbbell Lateral Hold | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| dumbbell-lateral-raise-isometric-hold | DB Lateral Raise Isometric Hold | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| banded-lateral-raise | Banded Lateral Raise | Band | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| standing-dumbbell-press | Standing Dumbbell Press | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| banded-front-y-raise | Banded Front Y Raise | Band | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| 1-arm-dumbbell-upright-row | 1-Arm Dumbbell Upright Row | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| hammer-preacher-curl | Hammer Preacher Curl | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| barbell-curl | Barbell Curl | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| n1-style-short-head-curl | N1-Style Short-Head Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-wrist-curl | Cable Wrist Curl | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| cable-wrist-extension | Cable Wrist Extension | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| prone-trap-raise | Prone Trap Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| overhead-shrug | Overhead Shrug | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| power-shrug | Power Shrug | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| plate-loaded-lateral-neck-curl | Plate-Loaded Lateral Neck Curl | Plate | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| rack-pull | Rack Pull | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| snatch-grip-deadlift | Snatch-Grip Deadlift | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| inverted-row | Inverted Row | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| supinated-lat-pulldown | Supinated Lat Pulldown | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| machine-row | Plate-Loaded Machine Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-row | Weight-Stack Machine Row | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| russian-twist | Russian Twist | Medicine Ball | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| swiss-ball-rollout | Swiss Ball Rollout | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| pallof-press | Pallof Press | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| stomach-vacuum | Stomach Vacuum | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| modified-candlestick | Modified Candlestick | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| barbell-pin-press | Barbell Pin Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| decline-barbell-press | Decline Barbell Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| decline-smith-machine-press | Decline Smith Machine Press | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| low-incline-barbell-press | Low Incline Barbell Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| seated-barbell-shoulder-press | Seated Barbell Shoulder Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-front-raise | DB Front Raise | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| cable-front-raise | Cable Front Raise | Cable | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-rear-delt-swing | DB Rear Delt Swing | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| bench-dip | Bench Dip | Bodyweight | Total | Bodyweight / loadless semantics unchanged; any added load is total. |
| machine-dip | Plate-Loaded Machine Dip | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| weight-stack-machine-dip | Weight-Stack Machine Dip | Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| overhead-db-triceps-extension | Overhead DB Triceps Extension | Dumbbell | Total | One shared dumbbell; enter its full weight. |
| barbell-jm-press | Barbell JM Press | Barbell | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| db-reverse-lunge | DB Reverse Lunge | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| db-static-lunge | DB Static Lunge | Dumbbell | Per side | Enter one dumbbell, including one-arm variants; never add left and right. |
| smith-machine-split-squat | Smith Machine Split Squat | Smith Machine | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
| banded-push-up | Banded Push Up | Band | Total | Enter the full implement, selected stack, or total machine plates; unilateral execution does not halve it. |
