"""Inventory instruction-bearing source pages independently, without sending PDF data away."""

import hashlib
import json
from pathlib import Path
import re
import runpy
import sys

import pymupdf

read_lines = runpy.run_path(str(Path(__file__).with_name("pdf-borderless-evidence.py")))["lines"]
PATTERN = re.compile(r"partial|range of motion|\bROM\b|\bRIR\b|\bRPE\b|rest|warm[- ]?up|failure|tempo|superset|dropset|myo[- ]?rep|1\s*RM", re.I)


def extract(folder):
    result = []
    for path in sorted(Path(folder).glob("*.pdf")):
        pages = []
        with pymupdf.open(path) as document:
            for index, page in enumerate(document):
                lines = [" ".join(token["text"].strip() for token in tokens) for _, tokens in read_lines(page)]
                relevant = [line for line in lines if PATTERN.search(line)]
                if relevant:
                    pages.append({"page": index + 1, "lines": relevant})
            result.append({"pdf": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                           "pageCount": len(document), "instructions": pages})
        print(path.name, flush=True)
    return result


if __name__ == "__main__":
    Path(sys.argv[2]).write_text(json.dumps(extract(sys.argv[1]), ensure_ascii=False), encoding="utf-8")
