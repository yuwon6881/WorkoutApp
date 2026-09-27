"""Audit movement ownership of imported links against independent PDF evidence.

Usage: python scripts/pdf-compare-links.py <source links> <draft folder> <report>
Unresolved captions are reported separately and cannot establish verified ownership.
"""

import json
from pathlib import Path
import runpy
import re
import sys

helpers = runpy.run_path(str(Path(__file__).with_name("pdf-source-links.py")))
identity = helpers["identity"]
key = runpy.run_path(str(Path(__file__).with_name("pdf-compare-prescriptions.py")))["key"]


def name_keys(name):
    name = re.sub(r"^\[(?:TOPSET|BACK OFF)\]\s*", "", name, flags=re.I)
    plain = re.sub(r"\s*\((?:optional|heavy|top[- ]?set|back[- ]?off)\)\s*$", "", name, flags=re.I)
    plain = re.sub(r"^(?:topset|back off)\s+|\s+(?:optional|heavy|back off)$", "", plain, flags=re.I)
    plain = re.sub(r"\bez[- ]bar(?:\s+bar)?\b", "EZ bar", plain, flags=re.I)
    plain = re.sub(r"\bEZ\b(?![- ]bar)", "EZ bar", plain, flags=re.I)
    plain = re.sub(r"\bDB\b", "Dumbbell", plain, flags=re.I)
    plain = re.sub(r"\bBB\b", "Barbell", plain, flags=re.I)
    plain = re.sub(r"\bRDL\b", "Romanian Deadlift", plain, flags=re.I)
    plain = re.sub(r"\b(?:1|one)[- ]arm\b", "Single Arm", plain, flags=re.I)
    plain = re.sub(r"\bpull[- ]up\b", "pullup", plain, flags=re.I)
    words = re.findall(r"[a-z0-9]+", plain.lower())
    return {key(name), key(plain), "words:" + " ".join(sorted(words))}


def compare(documents, folder):
    result = []
    for document in documents:
        bindings = {}
        page_bindings = {}
        unbound = []
        for link in document["links"]:
            names = link["names"]
            if not names and link.get("caption"):
                names = [link["caption"]]
            if not names:
                unbound.append(link)
            for name in names:
                for name_key in name_keys(name):
                    bindings.setdefault(name_key, set()).add(link["identity"])
                    page_bindings.setdefault((link["page"], name_key), set()).add(link["identity"])
        def expected_links(name, page):
            keys = name_keys(name)
            local = set().union(*(page_bindings.get((page, value), set()) for value in keys))
            return local or set().union(*(bindings.get(value, set()) for value in keys))
        for path in sorted(Path(folder).glob(document["key"] + "*.draft")):
            draft = json.loads(path.read_text(encoding="utf-8"))
            report = {"pdf": document["pdf"], "branch": path.stem, "verified": 0,
                      "missing": [], "incorrect": [], "unresolved": [], "ambiguousSourceLinks": [],
                      "unboundSourceLinks": unbound, "rejectedSourceLinks": document["rejected"]}
            for day in draft["workouts"]:
                for exercise in day["exercises"]:
                    location = {"week": day["week"], "day": day["name"],
                                "page": exercise.get("sourcePage"), "exercise": exercise["sourceName"]}
                    actual = dict(exercise.get("demoLinks") or {})
                    if exercise.get("demoUrl"):
                        actual[exercise["sourceName"]] = exercise["demoUrl"]
                    for name, address in actual.items():
                        expected = expected_links(name, exercise.get("sourcePage"))
                        if len(expected) > 1:
                            report["ambiguousSourceLinks"].append(location | {"name": name, "sourceIdentities": sorted(expected)})
                        if not expected:
                            report["unresolved"].append(location | {"name": name, "url": address})
                        elif identity(address) not in expected:
                            report["incorrect"].append(location | {"name": name, "url": address,
                                                                   "sourceIdentities": sorted(expected)})
                        else:
                            report["verified"] += 1
                    for name in [exercise["sourceName"], *exercise.get("substitutions", [])]:
                        expected = expected_links(name, exercise.get("sourcePage"))
                        named_actual = [address for actual_name, address in actual.items() if name_keys(name) & name_keys(actual_name)]
                        if expected and not named_actual:
                            report["missing"].append(location | {"name": name, "sourceIdentities": sorted(expected)})
            result.append(report)
            print(f"{path.stem}: {report['verified']} verified, {len(report['missing'])} missing, "
                  f"{len(report['incorrect'])} incorrect, {len(report['unresolved'])} unresolved")
    return result


if __name__ == "__main__":
    documents = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    report = compare(documents, sys.argv[2])
    Path(sys.argv[3]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if len(report) == 0 or any(row["missing"] or row["incorrect"] or row["unresolved"] for row in report):
        raise SystemExit(1)
