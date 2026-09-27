"""Recover printed cell boundaries from filled PDF rectangles when grid inference drifts.

Source fill rectangles are independent evidence of row ownership. No imported names,
values or program identities are used to select or repair a row.
"""

import json
from pathlib import Path
import re
import runpy
import sys

import pymupdf

columns = runpy.run_path(str(Path(__file__).with_name("pdf-source-rows.py")))["columns"]


def text_in_rect(words, rect):
    selected = {(*[round(value, 2) for value in word[:4]], word[4]): word for word in words
                if rect.contains(pymupdf.Point((word[0] + word[2]) / 2, (word[1] + word[3]) / 2))}.values()
    lines = []
    for word in sorted(selected, key=lambda word: (word[3], word[0])):
        line = next((line for line in lines if abs(line[0] - word[3]) < 3), None)
        if line is None:
            line = [word[3], []]
            lines.append(line)
        line[1].append(word)
    return " ".join(word[4] for _, line in sorted(lines) for word in sorted(line, key=lambda word: word[0]))


def unruled_rows(words, ranges, mapped, top, bottom, drawings):
    bounds = ranges[mapped["working"]]
    anchors = sorted({(word[1] + word[3]) / 2 for word in words
                      if top < (word[1] + word[3]) / 2 < bottom
                      and bounds[0] < (word[0] + word[2]) / 2 < bounds[1]
                      and re.fullmatch(r"\d{1,2}(?:[-–]\d{1,2})?", word[4])})
    result = []
    for index, anchor in enumerate(anchors):
        previous = anchors[index - 1] if index else top
        following = anchors[index + 1] if index + 1 < len(anchors) else anchor + (anchor - previous)
        y0, y1 = (previous + anchor) / 2, (anchor + following) / 2
        left = ranges[0][0] if ranges[0] else 0
        ruled = [drawing["rect"] for drawing in drawings if drawing["type"] == "s"
                 and drawing["rect"].width < 1 and abs(drawing["rect"].x0 - left) < 3
                 and drawing["rect"].y0 < anchor < drawing["rect"].y1]
        if ruled:
            row_border = min(ruled, key=lambda rect: rect.height)
            y0, y1 = row_border.y0, row_border.y1
        rectangles = [pymupdf.Rect(bounds[0], y0, bounds[1], y1) if bounds else None for bounds in ranges]
        if mapped["name"] > 0 and rectangles[0]:
            spine = [drawing["rect"] for drawing in drawings if drawing["type"] == "f"
                     and abs(drawing["rect"].x0 - rectangles[0].x0) < 3
                     and abs(drawing["rect"].x1 - rectangles[0].x1) < 3
                     and drawing["rect"].y0 < anchor < drawing["rect"].y1]
            if spine:
                rectangles[0] = max(spine, key=lambda rect: rect.height)
        cells = [text_in_rect(words, rect) if rect else "" for rect in rectangles]
        if not cells[mapped["name"]] or re.search(r"\b(?:volume|training time)\b", cells[mapped["name"]], re.I):
            continue
        result.append((cells, [list(rect) if rect else None for rect in rectangles]))
    return result


def recover(page, original):
    found = []
    page_drawings = page.get_drawings()
    drawings = [drawing["rect"] for drawing in page_drawings if drawing["type"] == "f"]
    words = sorted(page.get_text("words"), key=lambda word: (round(word[1], 1), word[0]))
    for table in original:
        header_index = next((index for index, row in enumerate(table["rows"]) if columns(row)), None)
        if header_index is None:
            found.append(table)
            continue
        mapped = columns(table["rows"][header_index])
        name_index = mapped["name"]
        name_rect = table["cells"][header_index][name_index]
        if name_index == 0 or not name_rect:
            found.append(table)
            continue
        name_rect = pymupdf.Rect(name_rect)
        printed_header = next((rect for rect in drawings if abs(rect.x0 - name_rect.x0) < 3
                               and abs(rect.x1 - name_rect.x1) < 3
                               and abs(rect.y0 - name_rect.y0) < 3), None)
        if printed_header:
            # An inferred grid can absorb the first exercise into the header. The
            # original filled header bounds establish where body rows actually begin.
            name_rect = printed_header
            header_cells = list(table["rows"][header_index])
            for index, bounds in enumerate(table["cells"][header_index]):
                if bounds:
                    header_cells[index] = text_in_rect(words, pymupdf.Rect(bounds[0], name_rect.y0, bounds[2], name_rect.y1))
            table["rows"][header_index] = header_cells
            mapped = columns(header_cells)
        next_header = min((other["bbox"][1] for other in original if other["bbox"][1] > name_rect.y1), default=page.rect.height)
        rows = [rect for rect in drawings if abs(rect.x0 - name_rect.x0) < 3
                and abs(rect.x1 - name_rect.x1) < 3 and rect.y0 >= name_rect.y1 - 2
                and rect.y0 < next_header and rect.height >= 8]
        rows = sorted(set(tuple(rect) for rect in rows), key=lambda rect: rect[1])
        count = len(table["rows"][header_index])
        ranges = []
        for index in range(count):
            rects = [row[index] for row in table["cells"][header_index:] if row[index]]
            bounds = min(rects, key=lambda rect: rect[2] - rect[0]) if rects else None
            if index == mapped.get("notes") and table["cells"][header_index][index]:
                bounds = table["cells"][header_index][index]
            ranges.append((bounds[0], bounds[2]) if bounds else None)
        if not rows:
            extra = unruled_rows(words, ranges, mapped, name_rect.y1, next_header, page_drawings)
            below = any(rectangles[mapped["working"]][1] > table["bbox"][3] for _, rectangles in extra)
            if not below:
                found.append(table)
                continue
            result = {"bbox": table["bbox"], "rows": table["rows"][:header_index + 1], "cells": table["cells"][:header_index + 1]}
            for cells, rectangles in extra:
                result["rows"].append(cells)
                result["cells"].append(rectangles)
            found.append(result)
            continue
        result = {"bbox": table["bbox"], "rows": table["rows"][:header_index + 1], "cells": table["cells"][:header_index + 1]}
        # Preserve the child labels of merged header bands.
        after = header_index + 1
        if after < len(table["rows"]) and not re.match(r"\d", table["rows"][after][mapped["working"]]):
            result["rows"].append(table["rows"][after])
            result["cells"].append(table["cells"][after])
        for box in rows:
            row_rect = pymupdf.Rect(box)
            # Filled body cells provide stronger column boundaries than a merged
            # header's inferred grid, especially when headings span two columns.
            body_cells = sorted({tuple(rect) for rect in drawings
                                 if abs(rect.y0 - row_rect.y0) < 2
                                 and abs(rect.y1 - row_rect.y1) < 2
                                 and rect.width > 20}, key=lambda rect: rect[0])
            body_ranges = [(rect[0], rect[2]) for rect in body_cells]
            if len(body_ranges) == len(ranges) - 1 and mapped.get("name") == 1:
                body_ranges.insert(0, ranges[0])
            row_ranges = body_ranges if len(body_ranges) == len(ranges) else ranges
            cells = []
            rectangles = []
            for index, bounds in enumerate(row_ranges):
                rect = pymupdf.Rect(bounds[0], row_rect.y0, bounds[1], row_rect.y1) if bounds else None
                if index == 0 and rect:
                    spine = next((candidate for candidate in drawings if abs(candidate.x0 - rect.x0) < 3
                                  and abs(candidate.x1 - rect.x1) < 3 and candidate.contains(rect.tl + (rect.br - rect.tl) / 2)), None)
                    if spine:
                        rect = spine
                cells.append(text_in_rect(words, rect) if rect else "")
                rectangles.append(list(rect) if rect else None)
            if re.match(r"\d", cells[mapped["working"]]):
                result["rows"].append(cells)
                result["cells"].append(rectangles)
        found.append(result)
    return found


if __name__ == "__main__":
    path = Path(sys.argv[2])
    evidence = json.loads(path.read_text(encoding="utf-8"))
    for item in evidence:
        with pymupdf.open(Path(sys.argv[1]) / item["pdf"]) as document:
            for page in item["pages"]:
                page["tables"] = recover(document[page["page"] - 1], page["tables"])
        print(item["pdf"], flush=True)
    path.write_text(json.dumps(evidence, ensure_ascii=False), encoding="utf-8")
