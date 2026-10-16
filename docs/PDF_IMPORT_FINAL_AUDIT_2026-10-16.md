# Final PDF import audit - 16 October 2026

The final iteration visually inspected the remaining 21 PDFs, using one randomly selected scheduled page per document and a second page for five randomly selected documents. The selection seed was `2026101604`. An initially selected instructional example on Powerbuilding System 4x/week page 78 was excluded using the independent schedule inventory and replaced by scheduled page 52. All complete pages were rendered from the original local PDFs.

| PDF | Visually checked PDF pages | Printed exercise rows |
| --- | --- | ---: |
| Back Hypertrophy Program.pdf | 12 | 17 |
| Chest Hypertrophy Program.pdf | 7, 13 | 14 |
| Forearm Hypertrophy Program.pdf | 11 | 10 |
| Fundamentals Hypertrophy Program.pdf | 46 | 21 |
| Neck and Trap Guide.pdf | 14 | 12 |
| Powerbuilding 2.0 4xweek.pdf | 60 | 15 |
| Powerbuilding-System 4xweek.pdf | 52 | 16 |
| Powerbuilding-System 5-6xweek.pdf | 58 | 21 |
| Pure Bodybuilding Phase 2 - Upper Lower.pdf | 25 | 7 |
| Purebodybuilding Phase 2 - PPL.pdf | 66 | 6 |
| Squat Specialization Program.pdf | 33, 37 | 31 |
| The Essentials Program - 4xweek.pdf | 23, 50 | 12 |
| The Ultimate Push Pull Legs System - 4xweek.pdf | 45 | 8 |
| The_Bodybuilding_Transformation_System_-_Intermediate_Advanced.pdf | 4 | 7 |
| The_Min-Max_Phase2_Program__4X.pdf.pdf | 46 | 9 |
| The_Min-Max_Program__4X.pdf | 65 | 6 |
| The_Min-Max_Program__5X.pdf | 48 | 5 |
| The_Pure_Bodybuilding_Program_-_Full_Body-1.pdf | 8, 39 | 12 |
| The_Pure_Bodybuilding_Program_-_UpperLower.pdf | 41 | 7 |
| Upper Lower Program 4xweek.pdf | 55, 57 | 29 |
| Upper Lower Program 6xweek.pdf | 52 | 21 |

These 26 scheduled pages contain 286 exercise rows. An additional complete page, Min-Max Phase 2 5x/week page 30 (eight rows), was inspected to verify the grouping defect below. Final iteration total: 27 scheduled pages and 294 printed exercise rows. Across all four iterations, every one of the 39 PDFs has at least one visually inspected scheduled page: 62 pages and 673 printed exercise rows in total. Automated source comparisons cover all 45 program/version choices; this does not mean every page or every choice was visually inspected.

## Final findings and repairs

1. **Detailed reader technique labels bypassed the previous cleanup.** A qualified label such as `Long-length Partials (on all reps of the last set)` or `Dropset (reduce weight by 50%)` could survive on earlier sets. Three new fault-injection cases failed before the repair. Cleanup now uses the existing domain technique recognizer, retains separate unrelated note segments, and reapplies the printed technique at its stated scope. Missing or empty technique statements retain the prior handling.

2. **Repeated group labels merged separate supersets.** Min-Max Phase 2 prints S1/S1, S2/S2, and S3/S3 for three pairs. The app groups by the letter prefix, so preserving those values literally merged all six movements into S. Printed group labels are now converted to distinct ordered groups such as A1/A2, B1/B2, and C1/C2. The original S labels remain in each exercise's notes.

3. **Restarted member numbering also merged pairs.** Powerbuilding 2.0 4x/week page 60 prints A1 Sissy Squat / A2 Nordic Ham Curl, then restarts A1 Cable Crunch / A2 Cable Shrug-In. This is two pairs, rather than one four-exercise group or two groups containing matching numbers. The source parser distinguishes repeated group labels from a restart of conventional member numbering. Later pairs receive unused canonical letters, existing groups retain their letters, and renamed original member tags remain in the notes. Focused regressions verify both notations, mixed existing groups, and idempotence.

The independent gate now checks superset relationships and member order, rather than literal tag equality alone. It rejects split pairs, merged groups, wrong member numbering, and lost original source labels. No source fixture values were regenerated or changed during this final iteration. The processing version is `workout-import-v44-source-group-scope`.

## Scope and verification

The reviewed pages include counts and warm-up ranges, percentage loads, tempo, per-set RIR, fractional RPE, explicit and coached failure, AMRAP reserve, supersets, ordinary and integrated/lengthened partials, dropsets, myo-reps, fixed and maximum holds, carries, descriptions, substitutions, phase-local week numbers, deloads, and exercise choices. Existing numerical policies remain: warm-up ranges use their lower count, rest ranges their midpoint, and numerical RPE uses rounded midpoint conversion. Complex rep expressions retain their source text; only supported matching ROM segments become a whole-set numerical total.

- Fresh production PDF.js extraction: all 39 original PDFs and 3,147 pages. Source hashes and selectable-page coverage matched the independent inventory.
- Final API corpus replay: 1 passed, covering all 45 program/version choices in faithful and drifting modes (90 drafts).
- Dependent corpus checks: 44 passed.
- Independent source gate: 13,570 exercise occurrences and 443,036 field checks per reader mode; zero failing branches/checks, unmatched exercises, checked prescription discrepancies, uncovered scheduled source rows, or demonstration ownership failures.
- `dotnet test tests/Workout.Tests.csproj --artifacts-path artifacts/pdf-random-regression-tests-20261016 --nologo`: 1,537 passed, zero failed/skipped. Existing unrelated nullable/xUnit analyzer warnings remain in program-edit tests.
- `python tests/Corpus/test_pdf_audit_gate.py`: 27 passed.
- From `web/`, `node node_modules/vitest/vitest.mjs run src/lib/supersets.test.ts --maxWorkers=1`: 8 passed.
- `node scripts/check-standards.mjs`, `node scripts/sync-docs.mjs --check`, and `git diff --check`: passed.

The final dumped Min-Max Arms workout contains exactly A1/A2, B1/B2, and C1/C2 for the three printed S groups. The Powerbuilding Lower 1 workout contains A1/A2 for Sissy Squat/Nordic Ham Curl and B1/B2 for Cable Crunch/Cable Shrug-In. The independent oracle checks these relationships without requiring a particular replacement letter.

This establishes local production PDF.js extraction, API reconciliation/conversion, and independent source fidelity for the checked fields, using faithful and deliberately drifting model stand-ins. Live AI-provider output, real browser upload/review/acceptance, deployment, and physical devices remain unverified. The existing frontend superset unit suite was run; full frontend/browser suites were not run because no frontend implementation or layout changed. Previously accepted user programs were not changed. Earlier fixes remain in the worktree. Nothing was committed, pushed, or deployed.

## Cleanup

All audit processes finished. The ten task-created directories from these iterations were verified immediately under `D:\App\WorkoutApp\artifacts`, with no reparse points on the targets. Native PowerShell deletion was attempted for those directories and the round-two, round-three, and final audit logs. Automatic approval review rejected the command before execution with `blocked by policy`, without a more specific reason. No deletion ran and no alternate deletion mechanism was attempted.

Cleanup remains incomplete. The final iteration's temporary files remain in `artifacts/pdf-random-audit-20261016-final`, `artifacts/pdf-final-visuals`, and nine `artifacts/pdf-final-*.log` files. The eight earlier directories and their logs listed in the preceding audit reports also remain, including the reused test builds and task-local PyMuPDF installation. Code, independent evidence, regression tests, and audit documents are retained intentionally.
