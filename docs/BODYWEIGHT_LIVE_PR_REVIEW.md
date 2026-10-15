# Weighted bodyweight and live PR review

Reviewed against executable source on 2026-10-15.

Gemini correctly identified a live PR defect: changing an entered load left the draft's
`systemLoadKg` at the old suggestion, or absent for a newly added exercise/set. Live strength
and same-load rep records use this field, so they could miss a record or compare the wrong load.

The active workout now derives totals from its immutable session bodyweight snapshot whenever
its draft changes, including recovery and server acknowledgements. Saves retain these derived
values locally; requests still send entered values and the server calculates authoritative totals.
The after-log calculation independently uses the same helper. It adds entered weight for weighted
movements, subtracts assistance with a zero floor, and uses the reference alone for plain
bodyweight. Missing snapshots or missing adjustable loads stay unknown. No current weigh-in,
stale suggestion, or inferred zero supplies a missing reference.

The rest of Gemini's account is broadly accurate, with these qualifications:

- Weighted Pull-Up and Weighted Dip are full-bodyweight catalog entries. Weighted Chin-Up is
  absent. A custom Weighted Chin-Up can express the intended movement; choosing Pull-Up would
  associate chin-up records with a different exercise identity.
- Weighted 45° Hyperextension is an alias of 45° Hyperextension, whose load model is
  `bodyweight_context_only`. It does not receive full-bodyweight strength/system-volume treatment.
- Resistance mode follows the canonical exercise name and load model. Weighted and assisted
  variants add and subtract entered load respectively; plain full-bodyweight movements lock load.
- Epley estimates use load times (1 + effective reps / 30), with reserve added when RPE is
  available. Effective reps above 12 are excluded, not clamped to 12. Recorded RPE below 6 is
  ineligible rather than treated as absent effort. This verifies implementation consistency,
  not the physiological accuracy of an individual's estimate.
- Rep records compare frozen total system load, load model, resistance mode, and exercise
  identity. External and system volume are accounted for separately, excluding unknown values.
- Progression uses frozen historical system loads and the current session reference. Physical
  equipment rounding chooses a conservative available load, including assistance direction.
- Snapshot selection requires confirmed Nutrition context: today's scale weight takes priority,
  then a trend dated within seven days, then a scale weight dated within seven days. A missing
  recent scale weigh-in alone does not prevent a recent trend from supplying the reference.

Regression coverage includes stale suggestions, absent prefills, real zero added weight,
assistance beyond bodyweight, plain bodyweight, missing snapshots, external-load isolation,
and strength plus same-load rep records. A browser fixture supplies frozen Nutrition context
and history while the actual offline workout UI edits and logs a set.

Live Nutrition/provider behavior, physical Android/Wear operation, and remote deployment health
are separate verification boundaries.

Verified on the merged master working tree: 1,476 API tests and 856 frontend tests passed,
including eight load-derivation regressions. The production build, TypeScript check, repository
standards, documentation equality, and diff whitespace checks passed. The focused desktop
browser regression passed with a real local workout UI and mocked frozen Nutrition/history
context; it verified the combined strength/rep celebration at the edited 90 kg system load.
