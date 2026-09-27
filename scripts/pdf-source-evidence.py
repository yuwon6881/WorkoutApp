"""Read printed tables independently of PDF.js and the production importer.

Usage: python scripts/pdf-source-evidence.py <PDF folder> <output JSON>
The result is raw source evidence, never a baseline inferred from imported drafts.
Review table headers, merged cells and unresolved rows before approving expectations.
"""

import hashlib
import json
from pathlib import Path
import re
import sys

import pymupdf


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def tables_on_page(page):
    text = page.get_text()
    if not re.search(r"\bsets?\b", text, re.I) or not re.search(r"\brep(?:s|etitions)?\b", text, re.I):
        return []
    result = []
    for table in page.find_tables().tables:
        rows = table.extract()
        if not any(
            any(re.search(r"\bsets?\b", clean(cell), re.I) for cell in row)
            and any(re.match(r"rep(?:s|etitions)?\b", clean(cell), re.I) for cell in row)
            for row in rows
        ):
            continue
        result.append({
            "bbox": list(table.bbox),
            "rows": [[clean(cell) for cell in row] for row in rows],
            "cells": [[list(cell) if cell else None for cell in row.cells] for row in table.rows],
        })
    return result


def extract(folder):
    documents = []
    for path in sorted(Path(folder).glob("*.pdf")):
        with pymupdf.open(path) as document:
            pages = []
            for index, page in enumerate(document):
                tables = tables_on_page(page)
                if tables:
                    pages.append({"page": index + 1, "tables": tables})
            documents.append({
                "pdf": path.name,
                "key": re.sub(r"\s+", "_", path.stem),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pageCount": len(document),
                "pages": pages,
            })
            print(f"{path.name}: {len(pages)} table pages", flush=True)
    return documents


if __name__ == "__main__":
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(extract(sys.argv[1]), ensure_ascii=False), encoding="utf-8")
