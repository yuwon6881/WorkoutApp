"""Independent character geometry reader for tables without vector rules.

The PDF may paint the same glyph more than once. Remove only equal characters
at equal positions; do not repair names using the exercise catalog or importer.
"""

import json
from pathlib import Path
import re
import sys

import pymupdf


def lines(page):
    rows = {}
    seen = set()
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            if line["dir"] != (1.0, 0.0):
                continue
            for span in line["spans"]:
                for char in span["chars"]:
                    if char["c"].isspace():
                        continue
                    x0, y0, x1, y1 = char["bbox"]
                    identity = (char["c"], round(x0, 1), round(y0, 1))
                    if identity in seen:
                        continue
                    seen.add(identity)
                    row = round(char["origin"][1], 1)
                    # An italic glyph's ink can extend before the preceding space.
                    # Origins preserve character order; ink bounding boxes do not.
                    rows.setdefault(row, []).append((char["origin"][0], x1, char["c"], y0, y1))
    result = []
    for baseline, chars in sorted(rows.items()):
        tokens = []
        for char in sorted(chars):
            if not tokens or char[0] - tokens[-1]["right"] > 4:
                tokens.append({"left": char[0], "right": char[1], "text": char[2]})
            else:
                # Some duplicate text layers place a space after the next letter.
                # Infer word spacing from the ink gap instead of those displaced spaces.
                if char[0] - tokens[-1]["right"] > max(0.6, (char[4] - char[3]) * 0.15):
                    tokens[-1]["text"] += " "
                tokens[-1]["text"] += char[2]
                tokens[-1]["right"] = max(tokens[-1]["right"], char[1])
        result.append((baseline, tokens))
    return result


def tables(page):
    result = []
    active = None
    boundaries = []
    for baseline, tokens in lines(page):
        texts = [token["text"].strip() for token in tokens]
        if "SETS" in texts and "REPS" in texts:
            if active:
                result.append(active)
            active = {"bbox": [0, baseline, page.rect.width, page.rect.height], "rows": [texts], "cells": [[None] * len(texts)]}
            boundaries = [(tokens[index]["right"] + tokens[index + 1]["left"]) / 2 for index in range(len(tokens) - 1)]
            continue
        if active is None:
            continue
        cells = [""] * len(active["rows"][0])
        for token in tokens:
            middle = (token["left"] + token["right"]) / 2
            index = sum(middle > bound for bound in boundaries)
            cells[index] = (cells[index] + " " + token["text"].strip()).strip()
        sets = active["rows"][0].index("SETS")
        if re.fullmatch(r"\d+", cells[sets]):
            active["rows"].append(cells)
            active["cells"].append([None] * len(cells))
        elif active["rows"] and len(active["rows"]) > 1 and not any(re.search(r"DAY|VOLUME|TRAINING|JEFF|NOTE:|SUPPLEMENTAL|TAKE THE FINAL SET", cell) for cell in cells) and any(re.search(r"[A-Z]", cell) for cell in cells):
            for index, cell in enumerate(cells):
                if cell:
                    active["rows"][-1][index] += " " + cell
    if active:
        result.append(active)
    return result


if __name__ == "__main__":
    evidence = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    for item in evidence:
        if item["pages"]:
            continue
        with pymupdf.open(Path(sys.argv[1]) / item["pdf"]) as document:
            for index, page in enumerate(document):
                found = tables(page)
                if found:
                    item["pages"].append({"page": index + 1, "tables": found})
        print(f"{item['pdf']}: {len(item['pages'])} borderless pages")
    Path(sys.argv[2]).write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
