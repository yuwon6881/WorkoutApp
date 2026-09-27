"""Refresh original cell text without changing independently established row boundaries."""

import json
import os
from pathlib import Path
import runpy
import sys

import pymupdf

text_in_rect = runpy.run_path(str(Path(__file__).with_name("pdf-cell-evidence.py")))["text_in_rect"]
columns = runpy.run_path(str(Path(__file__).with_name("pdf-source-rows.py")))["columns"]


def refresh(folder, evidence):
    for item in evidence:
        selected = os.environ.get("WORKOUT_SOURCE_FILTER")
        if selected and item["key"] not in selected.split(","):
            continue
        with pymupdf.open(Path(folder) / item["pdf"]) as document:
            for page in item["pages"]:
                words = document[page["page"] - 1].get_text("words")
                for table in page["tables"]:
                    for row, rectangles in zip(table["rows"], table["cells"]):
                        # Header band boundaries were independently corrected already; a
                        # merged inferred rectangle can otherwise absorb the first data row.
                        if columns(row):
                            continue
                        for index, bounds in enumerate(rectangles):
                            if bounds:
                                row[index] = text_in_rect(words, pymupdf.Rect(bounds))
        print(item["pdf"], flush=True)
    return evidence


if __name__ == "__main__":
    target = Path(sys.argv[2])
    evidence = json.loads(target.read_text(encoding="utf-8"))
    target.write_text(json.dumps(refresh(sys.argv[1], evidence), ensure_ascii=False), encoding="utf-8")
