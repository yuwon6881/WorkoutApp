# Random PDF import audit, third iteration - 16 October 2026

This iteration excluded the thirteen PDFs visually inspected in the previous two iterations, including documents reached through regression findings. PowerShell `Get-Random -Count 5` selected five other PDFs. Python `Random(2026101603)` selected two scheduled pages per document; each complete page was rendered from the original PDF and visually inspected against imported prescriptions and independent printed-source evidence.

| Selected PDF | Random PDF pages | Printed exercise rows |
| --- | --- | ---: |
| The Ultimate Push Pull Legs System - 5xweek.pdf | 68, 70 | 10 |
| The Essentials Program - 2xweek.pdf | 37, 39 | 14 |
| Bench Press Specialization Program.pdf | 46, 49 | 34 |
| Arm Hypertrophy Program.pdf | 9, 12 | 36 |
| The_Min-Max_Phase2_Program__5X.pdf.pdf | 34, 41 | 15 |

The ten random pages contain 109 printed rows, including two zero-set rows that must be omitted from the import. Additional visual inspection of Arm Hypertrophy pages 11, 13, and 14 checked the scope and exceptions of the newly identified footnotes. Total inspection: thirteen complete pages, 163 printed rows, including five zero-set rows correctly excluded from the draft.

The pages cover exercise identity/order, working and warm-up counts, exact and ranged reps, per-set RIR, rest, tempo, descriptions, substitutions, set techniques, final-set effort, carries, repeated rows with different targets, and source footnotes. Ultimate PPL pages 68 and 70 restart their printed week numbering in the second phase; their absolute imported week is 7. Warm-up ranges use their lower count and numerical RPE ranges retain the existing midpoint policy. Complex rep text stays available alongside numerical targets.

## Findings and fixes

1. **Conflicting set-type labels survived an explicit source technique column.** The Min-Max page prints a dash for the last-set technique. Fault-injected reader outputs retained dropset, myo-rep, partial-rep, or failure/AMRAP labels despite that source statement. Five initial regressions failed before the repair. Clean, matched table rows now replace recognized reader set-type labels when the technique cell explicitly states a value, including a dash. The source technique and its stated set scope are reapplied. Separate freeform coaching notes and techniques prescribed by the source coaching remain intact; missing or empty technique cells do not disprove instructions from elsewhere.

2. **Starred failure footnotes and exceptions were missed.** Arm Hypertrophy pages 11-14 print a final-set failure footnote below each table; two tables exclude close-grip bench press. The final footnote can share an extracted line with the weekly-volume tally. The parser now recognizes these forms, applies the instruction only to the owning table, preserves the named exception, retains the original footnote, and changes only final working-set effort. An exclusion must match a printed exercise before the parser applies the footer. The original source pages were inspected before adding 64 footer annotations to the independent prescription fixture.

3. **Single-set coaching effort was lost.** Bench Press page 46 prints a heavy set of five at `@RPE9`; page 49 prints an AMRAP at `@RPE9` beside an 85% load. Previously both lost their numerical effort. An explicit, unambiguous `@RPE` instruction now supplies a single working set's missing effort. The AMRAP retains one rep in reserve, without invented failure. Conditional instructions, multiple conflicting targets, and an unscoped multi-set instruction remain unassigned.

4. **Descending-ROM reps were incomplete.** Arm Hypertrophy prints `10+5+5` with coaching specifying ten full-ROM reps, five top-end-ROM reps, and five bottom-end-ROM reps. The partial-rep technique and whole-set total were missed. These explicit ROM forms now participate in the existing segment matching: the target becomes 20, the printed `10+5+5` stays intact, and the sets carry the partial-rep technique. Counts are totalled only when the printed sequence and coaching counts agree.

The independent audit now rejects invented intensity tags beside an explicit no-technique marker, lost coaching effort, omitted failure-footnote text, and wrong matched-ROM totals. Percentage-only cells in the independent Bench Press evidence now also populate the load field (37 original source cells), retaining their original cell text. Fixture edits use original PDF text/geometry and existing source cells; they were not generated from imported drafts. The evidence extractor was updated to retain these annotations in future regeneration. PDF hashes, inventory, and link evidence were unchanged.

The processing version is `workout-import-v43-printed-technique-authority`. Prior iteration fixes remain in place.

## Verification and limits

- Fresh production PDF.js extraction: 39 PDFs, 3,147 pages; source hashes and selectable-page coverage matched the independent inventory.
- Final production API corpus replay: 1 passed, covering 45 program/version choices in faithful and drifting modes (90 drafts).
- Dependent corpus checks: 44 passed.
- Independent gate: 39 PDFs, 45 choices, 13,570 exercise occurrences and 440,694 field checks per reader mode, zero failing branches/checks. No unmatched exercises, checked prescription discrepancies, uncovered scheduled source rows, or demonstration-link ownership failures remained.
- `dotnet test tests/Workout.Tests.csproj --artifacts-path artifacts/pdf-random-regression-tests-20261016 --nologo`: 1,531 passed, zero failed/skipped. Existing nullable/xUnit analyzer warnings remain in unrelated program-edit tests.
- `python tests/Corpus/test_pdf_audit_gate.py`: 25 passed.
- `node scripts/check-standards.mjs`, `node scripts/sync-docs.mjs --check`, and `git diff --check`: passed. Modified Python evidence/comparison scripts also parsed successfully.
- The strengthened independent comparison rejects the previous iteration's saved drafts for each newly identified footnote/coaching/ROM defect and accepts the fresh drafts for the same source rows. All random-page exercise counts matched after excluding printed zero-set rows.
- Compared with Git's original fixture, the only source-evidence changes are 64 Arm footer annotations and 37 Bench percentage-load annotations; all original row fields, document metadata, hashes, and row counts are preserved.

Production PDF.js extraction and the production API import pipeline are exercised locally with faithful and deliberately drifting model stand-ins. Live AI-provider output, browser upload/review/acceptance, deployment, and physical devices remain unverified. Frontend/browser suites were not run because no frontend implementation or layout changed. Original PDFs and accepted user programs were not modified. Nothing was committed, pushed, or deployed.

## Cleanup

All audit processes finished. The resolved cleanup targets were verified as directories immediately below this repository's `artifacts` folder, with no reparse points. Native PowerShell deletion was attempted for the eight task-created folders from these iterations and the matching round-two/round-three logs. Automatic approval review rejected the command before execution with `blocked by policy`, without a more specific reason. No deletion ran, and no alternative deletion mechanism was attempted.

Cleanup remains incomplete. This iteration's temporary output is in `artifacts/pdf-random-audit-20261016-round3`, `artifacts/pdf-random-round3-visuals`, and nine `artifacts/pdf-random-round3-*.log` files. The six earlier temporary directories listed in the round-two report also remain, including reused test builds and task-local PyMuPDF. Source changes, independent source annotations, regression tests, and audit reports are retained intentionally.
