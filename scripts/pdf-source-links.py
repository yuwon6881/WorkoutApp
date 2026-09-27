"""Read link evidence locally from original PDF annotations and printed table cells.

The audit records source geometry and video/start identity. No remote video is fetched.
"""

import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, urlparse

def identity(address):
    parsed = urlparse(address)
    host = parsed.hostname or ""
    query = parse_qs(parsed.query)
    if host.endswith("youtu.be"):
        video = parsed.path.strip("/")
    elif host.endswith("youtube.com"):
        video = query.get("v", [""])[0] if parsed.path == "/watch" else parsed.path.rstrip("/").split("/")[-1]
        if parsed.path != "/watch" and not re.match(r"^/(?:shorts|embed|live|v)/", parsed.path):
            return None
    else:
        return address.replace("http://", "https://") if host in ("exrx.net", "www.exrx.net", "roguefitness.com", "www.roguefitness.com") else None
    if not re.fullmatch(r"[\w-]{11}", video):
        return None
    time = query.get("t", query.get("start", ["0"]))[0]
    if re.fullmatch(r"\d+", time):
        seconds = int(time)
    else:
        parts = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", time)
        if not parts:
            return None
        seconds = sum(int(value or 0) * unit for value, unit in zip(parts.groups(), (3600, 60, 1)))
    return f"youtube:{video}@{seconds}"


def caption(words_on_page, rect):
    import pymupdf

    words = []
    for word in words_on_page:
        x0, y0, x1, y1, text, *_ = word
        if rect.contains(pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2)):
            words.append((round(y0, 1), x0, text))
    return " ".join(word[2] for word in sorted(set(words)))


def glossary_name(words, rect):
    line = sorted([word for word in words if word[2] <= rect.x0 + 2
                   and abs((word[1] + word[3]) / 2 - (rect.y0 + rect.y1) / 2) < 5], key=lambda word: word[0])
    text = " ".join(word[4] for word in line).strip()
    return text[:-1].strip() if text.endswith(":") else None


def extract(folder, source):
    import pymupdf

    result = []
    for item in source:
        named = []
        rejected = []
        with pymupdf.open(Path(folder) / item["pdf"]) as document:
            for index, page in enumerate(document):
                words_on_page = page.get_text("words")
                source_rows = [row for row in item["rows"] if row["page"] == index + 1]
                text = page.get_text(sort=True)
                # Join only address tails immediately following an explicitly named URL.
                text = re.sub(r"(https?://[^\s]+)\s*\n\s*([\w?=&%./#-]+)(?=\s*\n|$)", r"\1\2", text)
                for match in re.finditer(r"(?P<name>[^\n]{3,120}):\s*(?P<url>https?://[^\s]+)", text):
                    address = match["url"].rstrip(".,;)")
                    video = identity(address)
                    if video:
                        named.append({"page": index + 1, "url": address, "identity": video,
                                      "names": [match["name"].strip()], "association": "printed named URL"})
                for link in page.get_links():
                    address = link.get("uri")
                    if not address:
                        continue
                    record = {"page": index + 1, "url": address, "rect": list(link["from"]), "caption": caption(words_on_page, link["from"])}
                    video = identity(address)
                    if video is None:
                        rejected.append(record)
                        continue
                    center = (link["from"].tl + link["from"].br) / 2
                    bindings = []
                    for row in source_rows:
                        columns = [row["headers"]["name"], *row["headers"].get("substitutions", [])]
                        for column in columns:
                            bounds = row["rectangles"][column]
                            if bounds and pymupdf.Rect(bounds).contains(center):
                                bindings.append(row["cells"][column])
                    glossary = glossary_name(words_on_page, link["from"])
                    if not bindings and glossary:
                        bindings = [glossary]
                    named.append(record | {"identity": video, "names": sorted(set(bindings)), "association": "table" if bindings else "caption"})
        # Printed URLs are associated with a movement only when the source table keeps them
        # in that row. Wrapped addresses are joined within one cell, never across exercises.
        for row in item["rows"]:
            for cell in row["cells"]:
                compact = re.sub(r"\s+", "", cell)
                for match in re.finditer(r"https?://(?:www\.)?(?:youtu\.be/[\w-]{11}|youtube\.com/watch\?v=[\w-]{11})(?:[?&](?:t|start)=[\dhms]+)?", compact):
                    address = match[0]
                    named.append({"page": row["page"], "url": address, "identity": identity(address), "names": [row["name"]], "association": "printed row"})
        result.append({"pdf": item["pdf"], "key": item["key"], "sha256": item["sha256"],
                       "pageCount": item["pageCount"], "links": named, "rejected": rejected})
        print(f"{item['pdf']}: {len(named)} source links, {len(rejected)} rejected hosts/destinations")
    return result


if __name__ == "__main__":
    source = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    Path(sys.argv[3]).write_text(json.dumps(extract(sys.argv[1], source), ensure_ascii=False, indent=2), encoding="utf-8")
