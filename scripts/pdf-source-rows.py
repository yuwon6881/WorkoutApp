"""Convert independent PDF grid evidence into source rows for review and comparison.

This module never imports application code or reads actual drafts. It retains every
printed cell and its rectangle, so interpretations can be checked against the PDF.
"""

import json
from pathlib import Path
import re
import sys
import runpy

import pymupdf


def header(value):
    return re.sub(r"[^a-z0-9%]+", " ", value.casefold()).strip()


def columns(cells):
    result = {}
    for index, cell in enumerate(cells):
        name = header(cell)
        if name in ("exercise", "exercises", "movement"):
            result["name"] = index
        elif "set" in name and ("warm" in name):
            result["warmups"] = index
        elif re.fullmatch(r"(?:#?\s*of\s+)?(?:working\s+)?sets?", name):
            result["working"] = index
        elif re.match(r"rep(?:s|etitions)?\b", name):
            result["reps"] = index
        elif "early" in name and "rpe" in name:
            result["earlyRpe"] = index
        elif "last" in name and "rpe" in name and "lsrpe" not in name:
            result["lastRpe"] = index
        elif name in ("rpe", "ape", "rpe%", "rpe %", "rpe %1rm", "rpe 1rm"):
            result["rpe"] = index
        elif "rir" in name:
            result["rir"] = index
            result.setdefault("rirColumns", []).append(index)
        elif name.startswith("rest"):
            result["rest"] = index
        elif name in ("tempo", "notes"):
            result[name] = index
        elif name in ("%1rm", "% 1rm", "load", "%"):
            result["load"] = index
        elif "intensity" in name and "technique" in name:
            result["technique"] = index
        elif "substitution" in name or "option" in name:
            result.setdefault("substitutions", []).append(index)
    if "working" in result and "reps" in result:
        result.setdefault("name", 0)
        return result
    return None


def source_rows(document, folder=None):
    result = []
    context = {}
    if folder:
        with pymupdf.open(Path(folder) / document["pdf"]) as pdf:
            for page in document["pages"]:
                text = pdf[page["page"] - 1].get_text(sort=True)
                stated_unit = re.search(r"rest\s*(?:rest\s*)?times.{0,60}(min|sec)", text, re.I)
                minutes = re.search(r"rest.{0,80}(?:minutes?|mins?)", text, re.I)
                seconds = re.search(r"rest.{0,80}(?:seconds?|secs?)", text, re.I)
                context[page["page"]] = {
                    "heading": " ".join(text.splitlines()[:12]),
                    "weekLabels": re.findall(r"\bWEEK\s*\d+[AB]?(?:\s*[-–]\s*\d+)?", text, re.I),
                    "restUnit": stated_unit[1].lower() if stated_unit else "min" if minutes and not seconds else "sec" if seconds and not minutes else None,
                }
    for page in document["pages"]:
        for table_index, table in enumerate(page["tables"]):
            active = None
            day = ""
            for row_index, cells in enumerate(table["rows"]):
                found = columns(cells)
                if found:
                    active = found
                    if found["name"] == 0:
                        day = cells[0]
                    continue
                if active is None:
                    day = " ".join(cell for cell in cells if cell)
                    continue
                if "rir" in active:
                    children = [index for index, cell in enumerate(cells) if index >= active["rir"] and re.fullmatch(r"\(?Set\s+\d\)?", cell, re.I)]
                    if len(children) > 1:
                        active["rirColumns"] = children
                        continue
                name = cells[active["name"]]
                count = cells[active["working"]].strip(" `'")
                if not name or not re.match(r"^(?:\d|N/A|AMRAP|[-–])", count):
                    continue
                if re.search(r"\b(?:volume|training time)\b", name, re.I):
                    continue
                values = {key: cells[index] for key, index in active.items() if isinstance(index, int)}
                values["working"] = count
                values["substitutions"] = [cells[index] for index in active.get("substitutions", []) if cells[index]]
                values["rirBySet"] = [cells[index] for index in active.get("rirColumns", [])]
                if active["name"] > 0 and cells[0]:
                    day = cells[0]
                result.append({
                    "page": page["page"], "table": table_index, "row": row_index,
                    "day": day, "headers": active, "cells": cells,
                    "context": context.get(page["page"], {}),
                    "rectangles": table["cells"][row_index], **values,
                })
    if folder:
        line_reader = runpy.run_path(str(Path(__file__).with_name("pdf-borderless-evidence.py")))["lines"]
        with pymupdf.open(Path(folder) / document["pdf"]) as pdf:
            for page in document["pages"]:
                if not re.search(r"TAKE\s+THE\s+(?:FINAL|LAST)\s+SET\s+OF\s+EACH\s+EXERCISE\s+TO\s+FAILURE",
                                 pdf[page["page"] - 1].get_text(), re.I):
                    continue
                for baseline, tokens in line_reader(pdf[page["page"] - 1]):
                    text = " ".join(token["text"].strip() for token in tokens)
                    if not re.fullmatch(r"TAKE THE (?:FINAL|LAST) SET OF EACH EXERCISE TO FAILURE", text, re.I):
                        continue
                    prior = [(index, table["bbox"][1]) for index, table in enumerate(page["tables"]) if table["bbox"][1] < baseline]
                    if not prior:
                        continue
                    table_index = max(prior, key=lambda item: item[1])[0]
                    for row in result:
                        if row["page"] == page["page"] and row["table"] == table_index:
                            row["footer"] = text
    for page in document["pages"]:
        same_page = [row for row in result if row["page"] == page["page"]]
        units = {match[1].lower()[:3] for row in same_page if (match := re.search(r"\b(min|sec)\b", row.get("rest", ""), re.I))}
        if len(units) == 1:
            for row in same_page:
                if not row["context"].get("restUnit"):
                    row["context"]["restUnit"] = next(iter(units))
    return {key: document[key] for key in ("pdf", "key", "sha256", "pageCount")} | {"rows": result}


if __name__ == "__main__":
    documents = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    result = [source_rows(document, sys.argv[3] if len(sys.argv) > 3 else None) for document in documents]
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    for document in result:
        print(f"{document['key']}: {len(document['rows'])} source rows")
