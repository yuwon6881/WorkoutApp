# Independent PDF prescription evidence

These fixtures were extracted from all 39 original PDFs in `D:\App\Programs`, using local PyMuPDF text, filled cell rectangles, table grids, and link annotations. They do not use application parsers, imported drafts, or the corpus model stand-in. The inventory includes all 45 program and alternative-week choices. Prescription rows retain source page, table, row, and available rectangle references.

`prescriptions.json.gz` contains printed cells and contextual instructions; `links.json.gz` contains annotation/printed URL ownership and rejected destinations; `instructions.json.gz` inventories prescription-related instructions and discussion across every document. `inventory.json` records hashes, page counts, chosen page ranges, and reviewed week coverage. Repeated workout examples in instructional pages are scanned but excluded from scheduled workout coverage. Both Powerbuilding System PDFs explicitly print week 11 (deload), on page 67.

Regenerate evidence with the `scripts/pdf-source-*.py`, `pdf-cell-evidence.py`, and `pdf-borderless-evidence.py` tools, and review changes against original pages. Never update expectations from imported results. New or changed PDFs require independently reviewed expectations; the gate rejects missing or unexpected corpus files and changed hashes.

Forearm rows retain the separate printed HOLD cells (20/30 SEC, MAX HOLD and MAX STRIDES).
Back rows retain LSTF yes/no cells; the source FAQ defines these as the final-set failure instruction.
These fields were recovered from the independent original cell evidence and reviewed against source
pages, with the original source hashes and cell rectangles preserved.

After browser-equivalent extraction and a `CorpusReport` replay with `WORKOUT_CORPUS_DUMP=1`, run from the repository root:

```powershell
python scripts/pdf-audit-gate.py tests/Corpus/SourceExpected/prescriptions.json.gz tests/Corpus/SourceExpected/links.json.gz tests/Corpus/SourceExpected/inventory.json <extraction-folder> <report-folder>
```

For the complete extraction, normal/drift replay and independent gate in one serialized command, run `./scripts/test-pdf-import-audit.ps1 -Python <python-executable>`. It clears inherited single-PDF filters and restores the environment afterward.

The comparison needs only Python's standard library. Evidence regeneration needs PyMuPDF. The replay produces both normal and drift drafts, and the gate checks both, including explicit printed superset member tags and warm-up counts. Drift reads deliberately change those fields to check source authority. The runner generates every draft before the dependent spot checks run. A failure includes source locations and expected/actual fields in `source-audit.json`; missing exercises, choices, source pages, or fields cannot silently pass.

Readable numeric RPE outside the supported training range must remain in each affected set's source note without a guessed numerical effort. The API corpus report separately checks that these source conflicts finish ready for review at their printed page locations.

Arm Hypertrophy pages 11-14 include starred table-local final-set failure footnotes. Their source annotations retain each footer only on its own table and exclude the named close-grip bench press. These annotations were recovered from original PDF line geometry, not imported drafts. Bench Press percentage-only intensity cells also populate the source load field while retaining their original cell text. Coaching `@RPE9` and matching ROM segment totals are checked independently from the original coaching and rep cells.

Superset checks validate the relationships between exercises as well as their tags. Consecutive repeated labels such as S1/S1 identify one group; a later restart of member numbers such as A1/A2, A1/A2 identifies another group. Imported canonical groups must keep the members together, keep separate groups apart, preserve member order, and retain renamed source labels in the notes. Qualified reader technique labels are also tested against an explicit no-technique cell.

Run `python tests/Corpus/test_pdf_audit_gate.py` to verify that omitted exercises/choices/PDFs, changed hashes and incorrect rest averages fail the gate.
