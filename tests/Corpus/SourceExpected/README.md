# Independent PDF prescription evidence

These fixtures were extracted from all 39 original PDFs in `D:\App\Programs`, using local PyMuPDF text, filled cell rectangles, table grids, and link annotations. They do not use application parsers, imported drafts, or the corpus model stand-in. The inventory includes all 45 program and alternative-week choices. Prescription rows retain source page, table, row, and available rectangle references.

`prescriptions.json.gz` contains printed cells and contextual instructions; `links.json.gz` contains annotation/printed URL ownership and rejected destinations; `instructions.json.gz` inventories prescription-related instructions and discussion across every document. `inventory.json` records hashes, page counts, chosen page ranges, and reviewed week coverage. Repeated workout examples in instructional pages are scanned but excluded from scheduled workout coverage. Both Powerbuilding System PDFs explicitly print week 11 (deload), on page 67.

Regenerate evidence with the `scripts/pdf-source-*.py`, `pdf-cell-evidence.py`, and `pdf-borderless-evidence.py` tools, and review changes against original pages. Never update expectations from imported results. New or changed PDFs require independently reviewed expectations; the gate rejects missing or unexpected corpus files and changed hashes.

After browser-equivalent extraction and a `CorpusReport` replay with `WORKOUT_CORPUS_DUMP=1`, run from the repository root:

```powershell
python scripts/pdf-audit-gate.py tests/Corpus/SourceExpected/prescriptions.json.gz tests/Corpus/SourceExpected/links.json.gz tests/Corpus/SourceExpected/inventory.json <extraction-folder> <report-folder>
```

For the complete extraction, normal/drift replay and independent gate in one serialized command, run `./scripts/test-pdf-import-audit.ps1 -Python <python-executable>`. It clears inherited single-PDF filters and restores the environment afterward.

The comparison needs only Python's standard library. Evidence regeneration needs PyMuPDF. The replay produces both normal and drift drafts, and the gate checks both. A failure includes source locations and expected/actual fields in `source-audit.json`; missing exercises, choices, source pages, or fields cannot silently pass.

Run `python tests/Corpus/test_pdf_audit_gate.py` to verify that omitted exercises/choices/PDFs, changed hashes and incorrect rest averages fail the gate.
