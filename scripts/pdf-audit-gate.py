"""Fail the corpus audit on missing PDFs/choices, changed bytes, or source discrepancies.

Run after a fresh browser extraction and CorpusReport replay with WORKOUT_CORPUS_DUMP=1:
  python scripts/pdf-audit-gate.py <source rows> <source links> <inventory> <draft folder> <report folder>

The expected inputs come from independently reviewed PDF evidence, never imported drafts.
Comparison requires only the Python standard library; PDF evidence extraction needs PyMuPDF.
"""

import json
import gzip
from pathlib import Path
import runpy
import sys


def load(path):
    if str(path).endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as source:
            return json.load(source)
    return json.loads(Path(path).read_text(encoding="utf-8"))


def gate(rows, links, inventory, folder, output):
    failures = []
    expected = {item["key"]: item for item in inventory}
    if len(expected) != len(inventory) or not expected:
        failures.append("The source inventory is empty or contains duplicate PDFs")
    browser_sources = {path.stem for path in Path(folder).glob("*.json")}
    if browser_sources != set(expected):
        failures.append(f"Source expectation coverage differs: missing={sorted(set(expected) - browser_sources)}, unexpected={sorted(browser_sources - set(expected))}")
    for kind, documents in [("prescriptions", rows), ("links", links)]:
        actual = {item["key"]: item for item in documents}
        if set(actual) != set(expected):
            failures.append(f"{kind}: missing or unexpected PDF evidence: {sorted(set(actual) ^ set(expected))}")
        for name, source in actual.items():
            if name in expected and source["sha256"] != expected[name]["sha256"]:
                failures.append(f"{name}: {kind} source hash changed")
    for name, source in expected.items():
        path = Path(folder) / (name + ".json")
        if not path.exists():
            failures.append(f"{name}: browser extraction missing")
            continue
        browser = load(path)
        if browser.get("sha256") != source["sha256"] or browser["pageCount"] != source["pageCount"]:
            failures.append(f"{name}: browser source bytes/page count changed")
        if "pagesWithoutSelectableText" in source:
            expected_pages = set(range(1, source["pageCount"] + 1)) - set(source["pagesWithoutSelectableText"])
            actual_pages = {page["page"] for page in browser.get("pages", [])}
            if expected_pages != actual_pages:
                failures.append(f"{name}: selectable-text coverage differs: {sorted(expected_pages ^ actual_pages)}")
    prescriptions = runpy.run_path(str(Path(__file__).with_name("pdf-compare-prescriptions.py")))["audit"](rows, folder, inventory)
    destinations = runpy.run_path(str(Path(__file__).with_name("pdf-compare-links.py")))["compare"](links, folder)
    for branch in prescriptions:
        if branch["unmatched"] or branch["discrepancies"] or branch.get("uncoveredSourceRows"):
            failures.append(f"{branch['branch']}: prescription or coverage mismatch")
    for branch in destinations:
        if branch["missing"] or branch["incorrect"] or branch["unresolved"]:
            failures.append(f"{branch['branch']}: demonstration ownership mismatch")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    report = {"pdfCount": len(expected), "choiceCount": sum(len(item["choices"]) for item in inventory),
              "failures": failures, "prescriptions": prescriptions, "links": destinations}
    (output / "source-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['pdfCount']} PDFs, {report['choiceCount']} choices, {len(failures)} failing branches/checks")
    return not failures


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit(__doc__)
    raise SystemExit(0 if gate(load(sys.argv[1]), load(sys.argv[2]), load(sys.argv[3]), sys.argv[4], sys.argv[5]) else 1)
