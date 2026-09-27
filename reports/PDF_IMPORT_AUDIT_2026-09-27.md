# Independent PDF source audit — 2026-09-27

All 39 PDFs in `D:\App\Programs` were scanned locally: 3,147 pages, 3,135 selectable-text pages (12 blank/image-only pages retained as unguessable), every prescription table, relevant instruction, glossary and link annotation. All 45 program/alternative-week choices were replayed with both normal and drift readers. PDF bytes and images stayed local; no live or paid model request was made.

The independent source gate passed with zero failures across 90 replay branches. The normal branches compared 13,570 exercise occurrences and 418,374 prescription fields, and verified 35,248 exercise/substitution demonstration destinations by source ownership, video identity and start time. Missing choices, source rows/pages, changed hashes, exercise order and field mismatches fail the gate.

[Every expected/actual exercise and set comparison, with source page/table/row and discrepancy fields](PDF_IMPORT_SOURCE_COMPARISONS_2026-09-27.zip), [normal and drift imported drafts](PDF_IMPORT_AUDIT_2026-09-27.actual-drafts.zip), and [full replay report](PDF_IMPORT_CORPUS_2026-09-27.md) are retained. [Independent fixtures and rerun instructions](../tests/Corpus/SourceExpected/README.md) are separate from application output.

## Every PDF and choice

| PDF | Pages | Choice | Printed weeks | Prescription pages | Exercises | Fields | Demo associations | Result |
|---|---:|---|---:|---|---:|---:|---:|---|
| Arm Hypertrophy Program.pdf | 31 | single program | 8 | 7, 8, 9, 10, 11, 12, 13, 14 | 136 | 4075 | 0 | Normal + drift pass |
| Back Hypertrophy Program.pdf | 34 | single program | 9 | 7, 8, 9, 10, 11, 12, 13, 14, 15 | 145 | 4697 | 120 | Normal + drift pass |
| Bench Press Specialization Program.pdf | 78 | single program | 8 | 34, 35, 37, 38, 40, 41, 43, 44, 46, 47, 49, 50, 52, 53, 55, 56 | 212 | 5730 | 360 | Normal + drift pass |
| Chest Hypertrophy Program.pdf | 21 | single program | 8 | 6, 7, 8, 9, 10, 11, 12, 13 | 56 | 1705 | 112 | Normal + drift pass |
| Forearm Hypertrophy Program.pdf | 26 | single program | 8 | 6, 7, 8, 9, 10, 11, 12, 13 | 80 | 1734 | 0 | Normal + drift pass |
| Fundamentals Hypertrophy Program.pdf | 98 | full-body-program | 8 | 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48 | 168 | 6196 | 216 | Normal + drift pass |
| Fundamentals Hypertrophy Program.pdf | 98 | upper-lower-program | 8 | 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64 | 224 | 4704 | 272 | Normal + drift pass |
| Fundamentals Hypertrophy Program.pdf | 98 | bodypart-program | 8 | 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80 | 232 | 6260 | 240 | Normal + drift pass |
| High Frequency Full Body Program 4xweek.pdf | 104 | single program | 10 | 40, 41, 43, 44, 46, 47, 49, 50, 52, 53, 55, 56, 58, 59, 61, 62, 64, 65, 67, 68 | 301 | 10622 | 508 | Normal + drift pass |
| High Frequency Full Body Program 5xweek.pdf | 106 | single program | 10 | 41, 42, 44, 45, 47, 48, 50, 51, 53, 54, 56, 57, 59, 60, 62, 63, 65, 66, 68, 69 | 360 | 12788 | 610 | Normal + drift pass |
| Intermediate Advanced PPL Program 6xweek.pdf | 110 | single program | 16 | 32, 33, 35, 36, 38, 39, 41, 42, 44, 45, 47, 48, 50, 51, 53, 54, 56, 57, 59, 60, 62, 63, 65, 66, 68, 69, 71, 72, 74, 75, 77, 78 | 704 | 18643 | 400 | Normal + drift pass |
| Neck and Trap Guide.pdf | 31 | single program | 8 | 7, 8, 9, 10, 11, 12, 13, 14 | 96 | 2464 | 0 | Normal + drift pass |
| Powerbuilding 2.0 4xweek.pdf | 125 | single program | 12 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 64, 66, 67, 69, 70, 72, 73, 75 | 373 | 12748 | 576 | Normal + drift pass |
| Powerbuilding 2.0 5-6xweek.pdf | 123 | single program | 12 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 64, 66, 67, 69, 70, 72, 73 | 430 | 14657 | 686 | Normal + drift pass |
| Powerbuilding 3.0 4xweek.pdf | 111 | week-a | 10 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 66 | 227 | 8056 | 380 | Normal + drift pass |
| Powerbuilding 3.0 4xweek.pdf | 111 | week-b | 10 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 68 | 227 | 8053 | 380 | Normal + drift pass |
| Powerbuilding-3.0 5xweek.pdf | 111 | week-a | 10 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 66 | 227 | 8086 | 364 | Normal + drift pass |
| Powerbuilding-3.0 5xweek.pdf | 111 | week-b | 10 | 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 63, 68 | 227 | 8083 | 364 | Normal + drift pass |
| Powerbuilding-System 4xweek.pdf | 115 | week-a | 11 | 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 64, 68, 69, 71 | 320 | 10447 | 506 | Normal + drift pass |
| Powerbuilding-System 4xweek.pdf | 115 | week-b | 11 | 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 66, 68, 69, 71 | 320 | 10468 | 506 | Normal + drift pass |
| Powerbuilding-System 5-6xweek.pdf | 113 | week-a | 11 | 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 64, 68, 69 | 358 | 11470 | 574 | Normal + drift pass |
| Powerbuilding-System 5-6xweek.pdf | 113 | week-b | 11 | 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58, 60, 61, 66, 68, 69 | 358 | 11491 | 574 | Normal + drift pass |
| Pure Bodybuilding Phase 2 - Full Body.pdf | 55 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55 | 310 | 11309 | 1160 | Normal + drift pass |
| Pure Bodybuilding Phase 2 - Upper Lower.pdf | 55 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55 | 305 | 11148 | 1140 | Normal + drift pass |
| Purebodybuilding Phase 2 - PPL.pdf | 85 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85 | 485 | 17068 | 1780 | Normal + drift pass |
| Shoulder Hypertrophy Program.pdf | 31 | single program | 8 | 8, 9, 10, 11, 12, 13, 14, 15 | 152 | 3958 | 0 | Normal + drift pass |
| Squat Specialization Program.pdf | 70 | single program | 10 | 29, 31, 33, 35, 37, 39, 41, 43, 45, 47 | 143 | 3679 | 182 | Normal + drift pass |
| The Essentials Program - 2xweek.pdf | 66 | single program | 12 | 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43 | 180 | 4160 | 716 | Normal + drift pass |
| The Essentials Program - 3xweek.pdf | 78 | single program | 12 | 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55 | 240 | 6184 | 956 | Normal + drift pass |
| The Essentials Program - 4xweek.pdf | 90 | single program | 12 | 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67 | 288 | 8008 | 1144 | Normal + drift pass |
| The Essentials Program - 5xweek.pdf | 102 | single program | 12 | 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79 | 324 | 9028 | 1292 | Normal + drift pass |
| The Ultimate Push Pull Legs System - 4xweek.pdf | 102 | single program | 13 | 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88 | 347 | 11263 | 1352 | Normal + drift pass |
| The Ultimate Push Pull Legs System - 5xweek.pdf | 115 | single program | 13 | 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101 | 425 | 13934 | 1664 | Normal + drift pass |
| The Ultimate Push Pull Legs System - 6xweek.pdf | 128 | single program | 13 | 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114 | 493 | 16180 | 1936 | Normal + drift pass |
| The_Bodybuilding_Transformation_System_-_Beginner.pdf | 63 | single program | 12 | 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63 | 372 | 11040 | 1488 | Normal + drift pass |
| The_Bodybuilding_Transformation_System_-_Intermediate_Advanced.pdf | 63 | single program | 12 | 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63 | 408 | 14075 | 1632 | Normal + drift pass |
| The_Min-Max_Phase2_Program__4X.pdf.pdf | 79 | single program | 12 | 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73 | 396 | 8954 | 1584 | Normal + drift pass |
| The_Min-Max_Phase2_Program__5X.pdf.pdf | 91 | single program | 12 | 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85 | 444 | 9698 | 1752 | Normal + drift pass |
| The_Min-Max_Program__4X.pdf | 78 | single program | 12 | 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72 | 324 | 7855 | 1224 | Normal + drift pass |
| The_Min-Max_Program__5X.pdf | 90 | single program | 12 | 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84 | 420 | 10347 | 1608 | Normal + drift pass |
| The_Pure_Bodybuilding_Program_-_Full_Body-1.pdf | 55 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55 | 315 | 11086 | 1180 | Normal + drift pass |
| The_Pure_Bodybuilding_Program_-_PPL.pdf | 85 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85 | 480 | 16335 | 1760 | Normal + drift pass |
| The_Pure_Bodybuilding_Program_-_UpperLower.pdf | 55 | single program | 10 | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55 | 320 | 11399 | 1200 | Normal + drift pass |
| Upper Lower Program 4xweek.pdf | 87 | single program | 9 | 33, 34, 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58 | 258 | 9208 | 300 | Normal + drift pass |
| Upper Lower Program 6xweek.pdf | 87 | single program | 9 | 33, 34, 36, 37, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 55, 57, 58 | 360 | 9281 | 450 | Normal + drift pass |

## Confirmed fixes

- Preserve fractional, short-ROM, lengthened and integrated partial prescriptions with working-set scope. Source instructions that only discuss partials remain discussion. Warm-ups do not inherit working techniques. Partial extensions add neither extra sets nor invented rep counts.
- Keep count-only warm-up reps/load/tempo empty; retain explicit warm-up prescriptions. Duration, AMRAP division and RPE-test cells retain printed text without inventing numeric reps. RPE tests preserve their effort.
- Honor printed alternatives and qualifiers; repair wrapped, small-caps and rotated-label link captions, retain page ownership, and attach demos after recovered source rows are finalized.
- Bound the active timer display by its configured duration so a new 120-second timer never briefly shows 121; retain pause, countdown and extension behavior.
- Repair local SQLite GET/read locking so active-program repair reuses request ownership without deadlocking; keep competing requests serialized.
- Recover unlabeled exercise columns, maintain blank-rep rows in source order, distinguish tracking cells from coaching text, preserve short notes beside alternatives, and retain literal vertical separators inside notes.
- Apply explicit final-set failure footers, preserve printed RIR/RPE and percentage loads, and use arithmetic rest midpoints while retaining ranges and approximation markers.
- Preserve all program choices, including graphical week headings, asynchronous cycles, and the explicitly printed Powerbuilding System week 11 deload (page 67). Explanatory workout screenshots were scanned and are listed as reference pages in the independent inventory; they do not add scheduled workouts.

## Source contradictions and review boundaries

- High Frequency Full Body 4xweek page 56 and 5xweek pages 57/60/63, plus Upper Lower 6xweek page 49: printed rep target conflicts with the repeated 7+7+7 ROM sequence. Preserve both and require `rep_technique_conflict` review.
- Original Pure Bodybuilding Hack Squat: Full Body page 29, PPL page 40, Upper/Lower page 27 print two working sets but reference set three in coaching. Preserve two sets and issue `working_set_instruction_conflict`.
- Shoulder pages 12–15 print a final-set failure instruction alongside Cable External Rotation advice to avoid failure. Preserve exercise-specific evidence and issue `effort_instruction_conflict`.
- General partial-ROM discussion and citations, including Forearm page 19, High Frequency discussion/references, Intermediate PPL discussion, Upper/Lower discussion and Ultimate introductory text, do not assign techniques without clear movement/set scope.
- Source links rejected for host/destination policy, unbound annotations and multiple source identities are reported separately in the comparison archive. Verified mappings identify the printed video and start time; remote video availability was not checked.

## Verification

- Full API: 866 passed, none failed or skipped, including SQLite nested read/repair locking and blank-rep row ordering.
- Frontend: 360 passed across 46 files. Production build, typecheck, standards, documentation equality and `git diff --check` passed. Six independent-gate regressions passed, including missing PDF/choice/source row, changed hash and wrong rest average.
- Fresh browser-equivalent extraction: all 39 PDFs. CorpusReport: all 45 normal/drift choices passed. Independent gate: 39 PDFs / 45 choices / zero failures.
- Full visual: 45 passed; two desktop-only settings-navigation checks intentionally skipped on mobile/tablet. Import review/edit/restore/save, program creation, active-workout partial labels, demo destination and 120-second rest passed at 390/768/1440 px. Captured dark/light import screens were inspected. Responsive: all cases at 320/390/640/768/1024/1440/1920 px have passing results in both themes. The full run had 43 passes and one transient 320px dark-theme progression-tooltip tap failure; a fresh unchanged full 320px group passed all eight tests (including setup). Both results are retained, so this is not reported as a single clean first run.
- Live model-provider behavior, production browser sign-in and deployment remain unverified. No commit, push or deployment was performed during this continuation. Concurrent edits remain preserved.

## Browser evidence

- Full passing visual run: `web/artifacts/pdf-audit-visual-final-results`, with inspected screenshots in `web/artifacts/pdf-audit-visual-final-shots`.
- Full responsive run: `web/artifacts/pdf-audit-responsive-final-results`; fresh 320px rerun: `web/artifacts/pdf-audit-responsive-320-rerun-results`. Screenshots use the corresponding `-shots` directories. These local runtime artifacts are ignored by Git.
- API and browser checks used disposable local databases and the local model stand-in. Real provider interpretation and remote video availability remain unverified.
