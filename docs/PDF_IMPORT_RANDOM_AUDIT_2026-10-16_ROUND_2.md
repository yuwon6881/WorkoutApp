# Random PDF import audit, second iteration - 16 October 2026

This iteration excluded all five PDFs visually reviewed in the first iteration. PowerShell `Get-Random -Count 5` selected five other documents. Two scheduled pages per document were selected using Python `Random(2026101602)`, rendered from the original PDFs, and visually compared with the production import drafts and independent source fixtures.

| Selected PDF | Random PDF pages | Reviewed exercise rows |
| --- | --- | ---: |
| The Essentials Program - 5xweek.pdf | 43, 46 | 10 |
| The Essentials Program - 3xweek.pdf | 29, 33 | 15 |
| The_Bodybuilding_Transformation_System_-_Beginner.pdf | 29, 53 | 12 |
| The Ultimate Push Pull Legs System - 6xweek.pdf | 47, 101 | 14 |
| Intermediate Advanced PPL Program 6xweek.pdf | 33, 35 | 44 |

The ten random pages contain 95 exercise rows. They cover separate heavy/back-off rows, zero and ranged warm-up counts, explicit A1/A2 supersets, zero rest for first partners, final-set-only dropsets and failure, distinct early/final effort, percentage loads without invented RIR, timed stretch text without rep targets, partial reps, compound rep text, cluster-set counts and short rests, descriptions, substitutions, and repeated movements under several day tables on one page. Warm-up ranges use the lower printed count, RPE ranges use the existing rounded midpoint, and complex rep expressions retain their printed text; this iteration does not add new range or compound-movement representations.

## Source-confirmed defect and repair

Inspection of the whole-program replay report found an import failure in Essentials 3x/week that prescription-value comparisons alone had not identified as a defect. The original PDF prints RPE `1-9` for Machine Crunch on pages 34, 37, 40, and 43 (weeks 5-8). All four complete pages were rendered and visually checked, bringing the review to 14 pages and 115 exercise rows.

Previously, the unread-effort check failed the entire import and reported eight working sets as unread. The printed value is readable, but outside the app's supported training RPE range. It should reach source review without a guessed numerical effort.

The parser now retains unsupported numeric RPE and reversed ranges as source evidence. The affected sets keep `Printed RPE requires review: 1-9.` in their notes, clear guessed RPE/RIR, and produce a source-conflict warning for each affected workout. The import finishes ready for review; the user must resolve the warning before creating the program. Valid early-set effort remains intact when only the final-set cell is unsupported. Unread mixed cells still use the existing unread-value failure path. This is generic table handling, with no filename special case.

The independent Python comparison now requires the unsupported printed effort to survive in the set note and rejects guessed targets. Independent source prescriptions, source hashes, and inventory were not regenerated. The corpus behavior expectation now requires the four printed conflict locations instead of a single aggregate unread failure. The import processing version is `workout-import-v42-printed-effort-review`.

The stricter gate also found unsupported effort disappearing from merged percentage/RPE cells: Powerbuilding 2.0 5-6x/week page 63 prints `75%` with RPE `3`; Powerbuilding 3.0 4x/week and 5x/week page 63 print `65%` with RPE `4-5`. These low taper-week efforts are source prescriptions, not assumed typos. All three complete source pages were rendered and inspected. The percentage remains in the load field, and the effort now survives in its set note for review rather than disappearing. Neither the source loads nor the source efforts are changed to fit the app's supported numerical targets.

Total visual inspection for this iteration: 17 complete pages and 150 exercise rows across eight PDFs, including the five randomly selected documents and three additional documents reached through regression findings.

## Validation and limits

- Fresh browser-equivalent PDF.js extraction: all 39 PDFs and 3,147 pages, with source hashes and selectable-page coverage verified against the independent inventory.
- Final production API corpus generation: 1 passed, covering 45 program/version choices in faithful and deliberately drifting modes (90 drafts).
- Dependent corpus checks: all 44 passed.
- Independent source gate: 39 PDFs, 45 choices, 13,570 exercise occurrences and 434,164 field checks per reader mode, zero failing branches/checks; zero unmatched exercises, prescription discrepancies, uncovered scheduled source rows, or demonstration ownership failures.
- `dotnet test tests/Workout.Tests.csproj --artifacts-path artifacts/pdf-random-regression-tests-20261016 --nologo`: 1,511 passed, zero failed/skipped. Existing nullable/xUnit analyzer warnings remain in unrelated program-edit tests.
- `python tests/Corpus/test_pdf_audit_gate.py`: 22 passed.
- `node scripts/check-standards.mjs`, `node scripts/sync-docs.mjs --check`, and `git diff --check`: passed.

The first new focused regression failed because the printed unsupported value was lost; it passes after the repair. An existing assertion expecting this value to remain unread was updated to require preserved source text. The stricter corpus gate exposed the additional merged-column omissions, and passes after those were repaired. Source-conflict behavior expectations were updated only after inspecting the affected original pages.

This audit uses the production PDF.js text extractor and production API import pipeline with controlled faithful/drifting model stand-ins. It does not establish live AI-provider, browser upload/review/acceptance, deployment, Android, or physical-device behavior. No frontend layout changed, and frontend/browser suites were not run. Original PDFs and existing accepted programs were not changed. Previous iteration edits remain in place. Nothing was committed, pushed, or deployed.

## Cleanup

All audit processes finished. After verifying the resolved paths stayed immediately under this repository's `artifacts` directory and were not reparse points, cleanup was attempted with native PowerShell `Remove-Item -LiteralPath`. Automatic approval review rejected the command with `blocked by policy`, without a more specific reason. No deletion ran, and no alternative deletion mechanism was attempted.

Temporary folders remain: `artifacts/pdf-random-audit-20261016`, `artifacts/pdf-random-tools-20261016`, `artifacts/pdf-random-regression-tests-20261016`, `artifacts/pdf-audit-tests`, `artifacts/pdf-random-audit-20261016-round2`, and `artifacts/pdf-random-round2-visuals`. The seven `artifacts/pdf-random-round2-*.log` files from this iteration also remain. They hold extracted text, local drafts, detailed comparisons, source-page renders, task-local PyMuPDF, and test builds. Source changes, regression tests, and both audit documents are retained intentionally.
