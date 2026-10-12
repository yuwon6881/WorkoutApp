# Workout progression audit — 12 October 2026

## Formula and ownership

The server computes one frozen suggestion per working-set ordinal at workout start. It writes
the suggested load into `CompletedSet.WeightKg` and suggested reps into `CompletedSet.Reps`.
`Workout.tsx` adopts that session, and `WorkoutSetRow.tsx` supplies those values to the editable
load and reps controls. A suggestion never marks a set done or fills in actual effort.
First-time loads remain unknown. AMRAP, unstated reps and timed movements have no rep prefill.

The policy is double progression, with a bounded local load/reps estimate:

```text
reserve = recorded RIR, otherwise max(0, 10 − RPE)
capacity = prior comparable load × (30 + recorded reps + reserve)
estimated reps at a new load = floor(capacity / new load − 30 − target reserve)
```

`capacity` is available only for positive load/reps and at most 30 effective reps. Missing
reserve uses zero in the capacity estimate, with repeated-result requirements before progressing.
RIR `5+` contributes a lower bound of five, with calibration caps. Target ranges/floors use their
harder end. Strength records use a separate, stricter estimate capped at 12 effective reps.
These formulas are starting estimates; they do not guarantee a particular RIR or validate physiology.

`LoadResolution` chooses exercise override → account equipment rule → application default.
`LoadOptions` supplies physical next/previous weights and conservative rounding. Kilograms stay
canonical; stored increment units map to the display unit's gym steps, while weight lists retain
their physical values. Suggestions never modify the program's prescribed reps or effort.

## Nutrition rules

Only confirmed context within seven days can influence progression. Revoked/inactive consent
does not reuse a cached goal. Successful reads can be reused for the configurable six-hour
freshness window; outages have bounded live reads and a disclosed cache fallback.

| Qualified context | Mode | Exposures at the range ceiling before a load increase |
|---|---|---:|
| Maintenance/gain, without qualified rapid observed loss | Normal | 1 |
| Active loss goal below 0.75%/week | Conservative | 2 |
| Active loss goal at least 0.75%/week, target or qualified observed rate | Preservation | 3 |
| Maintenance/gain/finished phase losing at least 0.5%/week over 14+ days | Conservative | 2 |
| Missing, stale or unconfirmed context | Normal | 1 |

Unknown recorded effort requires at least two repeated results before cautious progression.
Preservation in-range rep increases additionally require two consecutive same-load/prescription
exposures, each at least as many reps as the latest result and one reserve rep above the target.
Without actual effort or a target, preservation holds in-range reps. Nutrition supplies the
qualified observation window; Workout does not independently recount Nutrition weigh-ins.

## Scenario coverage

| Scenario | Behavior reviewed and covered by tests |
|---|---|
| Exact/ranged reps | Build reps at the same load; qualify at the ceiling before a load step |
| Large/uneven increments | Reject impractical steps; earned ranges can temporarily rebuild below range within bounded floors |
| Missing reps/AMRAP | Keep inputs empty; load increases need repeated improvement |
| Missing/5+/ranged RIR | Distinguish unknown from known easy effort and use the target's harder end |
| Reps-only/partial-bodyweight | No invented bodyweight load, kilogram volume or strength |
| Full bodyweight | Frozen dated Nutrition reference; added load adds resistance, assistance subtracts it |
| Timed exercises | Seconds path; no rep progression, rep prefill or strength estimate |
| Warm-ups/techniques | Warm-ups excluded; techniques learn from the same technique and trailing techniques follow straight-set load |
| Heavy/light days/RIR tapers | Prescription matching within 14 days; compatible tapers retain evidence; planned deloads excluded |
| Hard exposures/stalls | Hold, reduce, then deload; older successful loads cannot make recovery heavier |
| Earlier-set fatigue | Later-set dips can be excused for at most two sessions; persistent difficulty counts again |
| Time away | Hold after 15 days; ease after 28/56; recency spans the movement's working-set ordinals |
| Start/recovery/finish | Editable suggestions remain unlogged; finished completed sets alone provide history |
| Catalog/unit changes | Explicit load models/modes and physical load rules; frozen historical values remain intact |

## Fixed findings

1. **Unavailable bodyweight equipment inputs.** A held 60 kg total at an 86 kg reference
   previously suggested 26 kg assistance even with a `[0, 10, 25, 40]` list. Fixed steps could
   round to a heavier total during a hard hold. Inputs now choose a real weight, prefer less added
   load/more assistance where possible, and recompute consistent total resistance. When no
   conservative physical choice exists, the reason discloses the difference. Assistance above
   bodyweight retains the actual input instead of fabricating an unlisted bodyweight-sized value.
2. **False later-set layoff.** Training one set recently and reintroducing a second last done
   35 days ago previously reduced that second set as though the movement had not been trained.
   Workout start and swaps now pass movement-wide recency without pooling set performance.
3. **Catalog synonym duplication.** Ten pairs are consolidated; obsolete names remain aliases.
   Source count: 431 → 421. Existing databases keep legacy ids active and usable. Listings collapse
   reviewed synonyms only when equipment, load model and tracking mode agree. Additive reseeding
   transfers alias ownership without deleting user data or rekeying snapshots. Histories/settings
   on legacy and canonical ids remain separate; this change does not merge historical records.

| Removed source slug | Retained canonical slug |
|---|---|
| `barbell-bench-press` | `bench-press` |
| `chest-press-machine` | `machine-chest-press` |
| `weight-stack-chest-press-machine` | `weight-stack-machine-chest-press` |
| `cable-seated-row` | `seated-cable-row` |
| `half-kneeling-1-arm-lat-pulldown` | `1-arm-half-kneeling-lat-pulldown` |
| `db-incline-curl` | `incline-dumbbell-curl` |
| `db-rdl` | `db-romanian-deadlift` |
| `cable-reverse-flye` | `reverse-cable-flye` |
| `bent-over-dumbbell-reverse-flye` | `bent-over-reverse-db-flye` |
| `barbell-overhead-press` | `overhead-press` |

Generic versus explicitly standing Arnold presses, unspecified versus standing calf machines,
and unspecified versus explicitly chest-supported machine rows remain distinct where the text
does not prove identical execution. Plate-loaded/weight-stack and weighted/assisted/plain variants
remain separate. Account-owned custom libraries and production data were not enumerated.

## Verification and limits

Regression tests reproduced both progression defects before their fixes. New coverage exercises
fractional references, physical lists/increments, first-time unknown loads, assistance above
bodyweight, grid limits, movement recency and Nutrition-driven input prefill. Catalog tests check
expanded/word-order synonyms, additive reseed idempotency, retained settings/history/progression,
and differences in load semantics.

The existing start/log/history browser workflow passed on 390 px phone, 768 px tablet and 1440 px
desktop, including actual load/reps input values. Gemini CLI fix, read-only audit and catalog
sessions timed out without a completed result or patch; the changes and verification were local.
The full API suite passed 1,314 tests; after adding four more equipment-boundary cases, the final
focused regression run passed 25 tests. Frontend tests passed 703 tests in 114 files. The browser
run passed three workflows plus two authentication setup tests. Production web build, final
typecheck, source standards, documentation equality and `git diff --check` passed. An earlier
typecheck observed incomplete concurrent navigation edits; the subsequent build/typecheck passed.
No production reseed, provider sign-in, physical Android/Wear validation, deployment, commit or
push was performed. Full PDF-corpus reconciliation and full visual/responsive suites were not run.
