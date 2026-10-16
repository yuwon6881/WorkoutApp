# Random PDF import audit — 16 October 2026

Five PDFs were selected with PowerShell `Get-Random -Count 5` from `D:\App\Programs` (39 PDFs). One scheduled table page per selected PDF was then chosen with Python `Random(20261016)`, rendered with PyMuPDF, and visually compared with the imported draft. Page numbers below are PDF page positions, including front matter.

| Randomly selected PDF | Visually reviewed page | Exercises on that page | Exercises checked throughout the program | Prescription checks throughout the program |
| --- | ---: | ---: | ---: | ---: |
| The_Pure_Bodybuilding_Program_-_PPL.pdf | 23 | 6 | 480 | 16,849 |
| Shoulder Hypertrophy Program.pdf | 14 | 19 | 152 | 4,172 |
| High Frequency Full Body Program 5xweek.pdf | 65 | 19 | 360 | 13,166 |
| Pure Bodybuilding Phase 2 - Full Body.pdf | 24 | 6 | 310 | 11,601 |
| High Frequency Full Body Program 4xweek.pdf | 59 | 16 | 301 | 10,945 |

The 66 visually reviewed exercise rows cover ordinary prescriptions, separate warm-up rows, warm-up ranges, percentage loads, early/final RPE, supersets, final-set failure footers, dropsets, myo-reps, integrated partials, partial-ROM instructions, descriptions, substitutions, and AMRAP with prescribed reserve. The top-set/back-off deadlift rows retain their separate names and loads. Warm-up ranges use their lower printed count; RPE ranges use the existing rounded midpoint policy, so this audit does not imply that a range is stored as two numerical effort bounds. Printed coaching text remains available.

## Findings and changes

The baseline local replay matched the sampled source expectations. Tests that deliberately supplied conflicting AI output exposed two gaps that a faithful reader did not exercise:

1. A nonempty AI warm-up count survived reconciliation even when the table explicitly prescribed another count. The sampled squat page prints three warm-ups and four working sets. Reconciliation now uses the printed warm-up field, including ranges and zero, rather than retaining an incorrect count. Count-only warm-ups still invent no reps, loads, tempo, effort, or technique.
2. An AI superset tag survived despite a conflicting printed member tag. The sampled shoulder page explicitly prints A1/A2 pairs. Printed tags now override conflicting group/order values. An untagged row still preserves grouping supplied by instructions elsewhere; absence of a tag is not evidence against such instructions.

Six regression cases failed before the fix; all seven new cases pass afterward (the seventh verifies missing-tag recovery). Two existing assertions were corrected because they had explicitly expected AI values to override printed warm-ups or superset order. The processing version is now `workout-import-v41-printed-set-metadata` so a new upload does not reuse an older ready import.

The independent Python gate now rejects lost or reordered printed superset tags. Its regression suite verifies both tag loss/reordering and wrong warm-up counts. The corpus drift reader now deliberately changes warm-up counts and existing superset tags. No source expectations were regenerated from imported results.

A fresh-folder audit also exposed a test-order defect: duration checks could execute before drafts and their output directory existed. The audit runner now completes draft generation before dependent spot checks, and the duration check creates its own output directory.

## Verification

- Browser-equivalent production PDF.js extraction: all 39 original PDFs, 3,147 pages. Source hashes and page coverage matched the independently reviewed inventory.
- Production API import pipeline replay: all 45 program/version choices, both faithful and deliberately drifting model stand-ins (90 drafts).
- Independent source gate: 13,570 exercise occurrences and 434,146 prescription checks per reader mode; zero unmatched exercises, prescription discrepancies, uncovered scheduled source rows, or demonstration ownership failures.
- Fields checked include exercise identity/order, working/warm-up counts, reps, effort/RIR, rest, printed superset member tags, set techniques and their scope, loads, tempo, coaching descriptions, and substitutions.
- `dotnet test tests/Workout.Tests.csproj --artifacts-path artifacts/pdf-random-regression-tests-20261016 --nologo`: 1,495 passed, zero failed/skipped. Existing nullable/xUnit analyzer warnings remain in unrelated program-edit tests.
- Final corpus generation and dependent spot checks were run separately, using the same filters now used by `scripts/test-pdf-import-audit.ps1`: generation passed (1 test), then all 44 dependent checks passed. The independent gate passed again after final draft generation.
- `python tests/Corpus/test_pdf_audit_gate.py`: 21 passed.
- `node scripts/check-standards.mjs`, `node scripts/sync-docs.mjs --check`, and `git diff --check`: passed.

Reproduce the complete extraction/replay/source gate with `./scripts/test-pdf-import-audit.ps1 -Python <python-executable>` from the repository root. Independent evidence is in `tests/Corpus/SourceExpected/`; the new focused regressions are in `tests/ImportPrintedMetadataTests.cs`.

## Evidence limits and cleanup

This verifies local parsing, reconciliation, conversion, catalog handling, and independent printed-source fidelity. Model responses were controlled local stand-ins; live AI-provider output, browser upload/review/acceptance, production deployment, and physical devices were not exercised. Full frontend and browser suites were not run because no frontend behavior or layout changed. Existing accepted programs were not modified. Nothing was committed, pushed, or deployed.

All task-started test/extraction processes completed. Automatic approval review rejected deletion of the four task-created temporary directories with `blocked by policy`, without a more specific reason. Cleanup is therefore incomplete: `artifacts/pdf-random-audit-20261016`, `artifacts/pdf-random-tools-20261016`, `artifacts/pdf-random-regression-tests-20261016`, and `artifacts/pdf-audit-tests` remain. They contain the temporary renders, extracted text/drafts, detailed reports, PyMuPDF installation, and test builds. Original PDFs, pre-existing artifact folders, and unrelated work were preserved. This report, source changes, and regression tests are retained intentionally.
