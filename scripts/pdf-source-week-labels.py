"""Read explicit week headings from native PDF spans, not paragraph references to weeks."""

import json
from pathlib import Path
import re
import sys

import pymupdf

HEADING = re.compile(r"^WEEK\s*\d+[AB]?(?:\s*[-–]\s*\d+)?(?:\s*:\s*DAYS?\s+\d+(?:-\d+)?)?\s*$", re.I)


def refresh(folder, documents):
    for item in documents:
        with pymupdf.open(Path(folder) / item["pdf"]) as document:
            labels = {}
            for number in sorted({row["page"] for row in item["rows"]}):
                lines = ["".join(span["text"] for span in line["spans"]).strip()
                         for block in document[number - 1].get_text("dict")["blocks"] if "lines" in block
                         for line in block["lines"]]
                found = []
                for index, line in enumerate(lines):
                    if line.upper() == "WEEK" and index + 1 < len(lines):
                        line += " " + lines[index + 1]
                    if HEADING.fullmatch(line):
                        label = re.match(r"WEEK\s*\d+[AB]?(?:\s*[-–]\s*\d+)?", line, re.I)[0]
                        if label not in found:
                            found.append(label)
                labels[number] = found
            for row in item["rows"]:
                row["context"]["weekLabels"] = labels[row["page"]]
        print(item["pdf"], flush=True)
    return documents


if __name__ == "__main__":
    target = Path(sys.argv[2])
    target.write_text(json.dumps(refresh(sys.argv[1], json.loads(target.read_text(encoding="utf-8"))), ensure_ascii=False), encoding="utf-8")
