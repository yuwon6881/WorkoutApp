"""Compare imported drafts with independently extracted printed source rows.

Usage: python scripts/pdf-compare-prescriptions.py <source rows> <draft folder> <report>
Unmatched and ambiguous rows fail coverage; they are not replaced with actual values.
"""

import json
import math
from pathlib import Path
import re
import sys
import unicodedata
import runpy
from collections import Counter

techniques = runpy.run_path(str(Path(__file__).with_name("pdf-technique-evidence.py")))


def key(value):
    value = unicodedata.normalize("NFKD", value)
    value = re.sub(r"^(?:superset\s+)?[a-z]\d+[:.]\s*", "", value, flags=re.I)
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def numbers(value):
    return [float(number) for number in re.findall(r"\d+(?:\.\d+)?", value)]


def count_bounds(value):
    value = re.sub(r"\s*(?:each|per\s+(?:leg|side))$", "", value, flags=re.I)
    value = value.rstrip("+")
    match = re.fullmatch(r"\s*(\d+)(?:\s*(?:[-–]|or)\s*(\d+))?\s*", value)
    return (int(match[1]), int(match[2] or match[1])) if match else None


def rounded_effort(value):
    if "%" in value:
        value = re.sub(r"\d+(?:\.\d+)?(?:[-–]\d+(?:\.\d+)?)?\s*%", "", value)
    values = numbers(value)
    if not values or any(number < 5 or number > 10 for number in values):
        return None
    return math.floor(sum(values) / len(values) + 0.5)


def expected_rest(value, unit=None):
    if unit == "min":
        value = re.sub(r"\bMN\b", "MIN", value, flags=re.I)
    if re.fullmatch(r"\s*(?:N/A|[-–]|)\s*", value, re.I):
        return None
    match = re.fullmatch(r"[~≈]?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(min|minutes?|sec|seconds?|s|m)?", value, re.I)
    if not match:
        return "unresolved"
    if not match[3] and unit is None:
        return "unresolved unit"
    midpoint = (float(match[1]) + float(match[2] or match[1])) / 2
    return math.floor(midpoint * (1 if (match[3] or unit).lower().startswith(("sec", "s")) else 60) + 0.5)


def compare(row, exercise):
    issues = []
    work = [item for item in exercise["sets"] if not item["warmup"]]
    warm = [item for item in exercise["sets"] if item["warmup"]]
    standalone_warmup = re.search(r"\bwarm\s*up\b", row["name"], re.I) is not None
    fields = 0

    def check(field, expected, actual):
        nonlocal fields
        fields += 1
        if actual != expected:
            issues.append({"field": field, "expected": expected, "actual": actual})

    counts = (("warmups", row["working"], len(warm)), ("working", "0", len(work))) if standalone_warmup else (("working", row["working"], len(work)), ("warmups", row.get("warmups", "0"), len(warm)))
    for label, value, actual in counts:
        bounds = count_bounds(value)
        if bounds:
            fields += 1
            if not bounds[0] <= actual <= bounds[1]:
                issues.append({"field": label, "expected": value, "actual": actual})
        else:
            issues.append({"field": label, "unresolvedSource": value})

    prescribed = warm if standalone_warmup else work
    source_note = row.get("notes", "").strip()
    if source_note and source_note.upper() not in ("N/A", "-"):
        check("coachingNoteCharacters", True, Counter(key(source_note[:1000])) <= Counter(key(exercise.get("notes") or "")))
        # Inserted overlay glyphs or retained model context may add characters,
        # but every printed instruction must still appear in source order.
        actual_characters = iter(key(exercise.get("notes") or ""))
        check("coachingNoteOrder", True, all(character in actual_characters for character in key(source_note)))
    for substitution in row.get("substitutions", []):
        if key(substitution) in ("na", "seenotes", "notes", ""):
            continue
        # The library may expand the entire printed name; compare common abbreviations only.
        def movement(value):
            value = re.sub(r"\bDB\b", "Dumbbell", value, flags=re.I)
            value = re.sub(r"\bRDL\b", "Romanian Deadlift", value, flags=re.I)
            value = re.sub(r"\bez[\s-]+bar(?:[\s-]+bar)?\b", "EZ bar", value, flags=re.I)
            value = re.sub(r"\b(?:1|one|single)[\s-]+arm\b", "single arm", value, flags=re.I)
            value = re.sub(r"\b(pull|push|chin)[\s-]+(up|down)s?\b", r"\1\2", value, flags=re.I)
            value = re.sub(r"\btriceps?\b", "tricep", value, flags=re.I)
            value = re.sub(r"\bsquats\b", "squat", value, flags=re.I)
            value = re.sub(r"\bEZ\b(?![- ]bar)", "EZ bar", value, flags=re.I)
            return sorted(re.findall(r"[a-z0-9]+", value.lower()))
        check("printedSubstitution", movement(substitution), next((movement(value) for value in exercise.get("substitutions", []) if movement(value) == movement(substitution)), None))
    expected_techniques = techniques["expected"](row, len(work)) if not standalone_warmup else []
    for index, item in enumerate(prescribed):
        prefix = f"set {index + 1} "
        printed_technique = row.get("technique", "").strip()
        if printed_technique and key(printed_technique) not in ("na", "none", "", "seenotes", "notes") and not standalone_warmup:
            all_sets = re.search(r"\b(?:all|each|every)\s+(?:working\s+)?sets?\b", printed_technique, re.I)
            specified = re.search(r"\b(?:on|for)\s+set\s+(\d+)\b", printed_technique, re.I)
            applies = bool(all_sets) or (index == int(specified[1]) - 1 if specified else index == len(work) - 1)
            if applies:
                check(prefix + "printedTechnique", True, Counter(key(printed_technique)) <= Counter(key(item.get("notes") or "")))
        if not standalone_warmup:
            expected_methods = expected_techniques[index]
            found_methods = techniques["actual"](item.get("notes"))
            # Specific lengthened/integrated labels also constitute partial-ROM work.
            if "partial" in expected_methods and found_methods & {"lengthened", "integrated"}:
                found_methods.add("partial")
            check(prefix + "partialTechniqueScope", sorted(expected_methods), sorted(found_methods))
        reps = row["reps"]
        reps = reps.strip().strip('"').strip()
        if re.fullmatch(r"\d+(?:\s*,\s*\d+)+", reps) and len(reps.split(",")) == len(prescribed):
            values = reps.split(",")
            reps = values[min(index, len(values) - 1)].strip()
        reps = re.sub(r"\s*(?:EACH(?:\s+LEG)?|per\s+(?:leg|side)|STEPS|\(dropset\))$", "", reps, flags=re.I)
        reps = re.sub(r"\s+STEPS$", "", reps, flags=re.I)
        match = re.fullmatch(r"(\d+)(?:\s*[-–]\s*(\d+))?", reps)
        if match:
            check(prefix + "repMin", int(match[1]), item["repMin"])
            check(prefix + "repMax", int(match[2] or match[1]), item["repMax"])
        elif re.fullmatch(r"\d+(?:\s*[/+,]\s*\d+)+(?:\+|X)?", reps, re.I) or re.fullmatch(r"\d+(?:-\d+)?\s*\+\s*\d+(?:-\d+)?", reps) or re.fullmatch(r"\d+(?:-\d+)?\s*\(\+\d+(?:\+\d+)*\)|\+\d+|\d+\+", reps):
            check(prefix + "repsText", re.sub(r"\s", "", reps), re.sub(r"\s", "", item.get("repsText") or ""))
        elif reps.upper() in ("N/A", "AMRAP", "FAILURE", "RPE ONLY", "HOLD", "NOTES", "-", "") or reps.upper().startswith("AMRAP/") or re.fullmatch(r"RPE\s*\d+(?:\.\d+)?\s*TEST|(?:(?:\d{1,2})?:\d{2}|\d+(?:[-–]\d+)?\s*[- ]?\s*(?:s|sec|seconds?|min|minutes?))(?:\s+(?:HOLD|each|per leg))?", reps, re.I):
            check(prefix + "emptyReps", True, item["repMin"] is None and item["repMax"] is None)
        else:
            issues.append({"field": prefix + "reps", "unresolvedSource": reps})
        effort = row.get("lastRpe" if index == len(work) - 1 else "earlyRpe", row.get("rpe", ""))
        if re.fullmatch(r"RPE\s*\d+(?:\.\d+)?\s*TEST", reps, re.I):
            effort = reps
        if row.get("footer") and index == len(work) - 1 and not re.search(r"\bavoid\s+failure\b", row.get("notes", ""), re.I):
            effort = "10"
        reserves = row.get("rirBySet", [])
        reserve = reserves[min(index, len(reserves) - 1)] if reserves else None
        if standalone_warmup:
            check(prefix + "emptyWarmupEffort", True, item["targetRpe"] is None and item.get("rir") is None)
        elif reserve is not None and re.fullmatch(r"[~≈]?\s*\d+(?:\.\d+)?\+?", reserve):
            count = math.floor(numbers(reserve)[0] + 0.5)
            check(prefix + "rir", str(count) + ("+" if "+" in reserve else ""), item.get("rir"))
            check(prefix + "targetRpe", 10 - count if count <= 4 else None, item["targetRpe"])
        elif reserve is not None and reserve.upper() not in ("", "N/A", "-"):
            issues.append({"field": prefix + "rir", "unresolvedSource": reserve})
        else:
            expected_rpe = rounded_effort(effort)
            if expected_rpe is not None:
                check(prefix + "targetRpe", expected_rpe if expected_rpe >= 6 else None, item["targetRpe"])
                check(prefix + "rir", str(10 - expected_rpe), item.get("rir"))
            elif any(field in row for field in ("rpe", "earlyRpe", "lastRpe", "rir")):
                check(prefix + "emptyEffort", True, item["targetRpe"] is None and item.get("rir") in (None, "", "N/A"))
        if "rest" in row:
            rest = expected_rest(row["rest"], row.get("context", {}).get("restUnit"))
            if isinstance(rest, str):
                issues.append({"field": prefix + "rest", "unresolvedSource": row["rest"]})
            else:
                check(prefix + "restSeconds", rest, item["restSeconds"])
                if rest is not None:
                    rest_text = item.get("restText") or ""
                    check(prefix + "printedRestNumbers", numbers(row["rest"]), numbers(rest_text))
                    check(prefix + "approximateRestMarker", bool(re.search(r"[~≈]", row["rest"])), bool(re.search(r"[~≈]", rest_text)))
        if row.get("tempo") not in (None, "", "-", "N/A"):
            check(prefix + "tempo", row["tempo"], item.get("tempo"))
        if row.get("load") not in (None, "", "-", "N/A"):
            source_load = re.sub(r"1\s*rm", "", row["load"], flags=re.I)
            actual_load = re.sub(r"1\s*rm", "", item.get("loadText") or "", flags=re.I)
            check(prefix + "loadNumbers", numbers(source_load), numbers(actual_load))
            check(prefix + "loadPercentageMarker", "%" in source_load, "%" in actual_load)
    if not standalone_warmup:
        for warmup in warm:
            check("count-only warmup empty reps", True, warmup["repMin"] is None and warmup["repMax"] is None and warmup.get("repsText") is None)
            check("count-only warmup empty tempo", None, warmup.get("tempo"))
            check("count-only warmup empty load", None, warmup.get("loadText"))
            check("warmup empty effort", True, warmup.get("targetRpe") is None and warmup.get("rir") is None)
            check("warmup empty technique", True, not warmup.get("notes"))
            check("warmup empty partial technique", [], sorted(techniques["actual"](warmup.get("notes"))))
    return fields, issues


def audit(documents, folder, inventory=None):
    report = []
    for document in documents:
        drafts = sorted(Path(folder).glob(document["key"] + "*.draft"))
        choices = next((item["choices"] for item in inventory or [] if item["key"] == document["key"]), None)
        if choices is not None:
            expected_branches = {document["key"] + ("." + choice["id"] if choice["id"] else "") + suffix
                                 for choice in choices for suffix in ("", ".drift")}
            missing = expected_branches - {path.stem for path in drafts}
            if missing:
                report.append({"pdf": document["pdf"], "branch": "missing choices", "unmatched": sorted(missing), "discrepancies": []})
        if not drafts or not document["rows"]:
            report.append({"pdf": document["pdf"], "branch": "missing coverage", "unmatched": ["Missing drafts or independent source rows"], "discrepancies": []})
        for path in drafts:
            draft = json.loads(path.read_text(encoding="utf-8"))
            branch = {"pdf": document["pdf"], "branch": path.stem, "rows": len(document["rows"]), "occurrences": 0, "fields": 0, "unmatched": [], "discrepancies": [], "uncoveredSourceRows": [], "comparisons": []}
            covered = set()
            prescription_pages = {exercise.get("sourcePage") for day in draft["workouts"] for exercise in day["exercises"]}
            if choices is not None:
                branch_name = path.stem.removesuffix(".drift")
                choice = next((choice for choice in choices if branch_name == document["key"] + ("." + choice["id"] if choice["id"] else "")), None)
                if choice is None:
                    branch["unmatched"].append("Unexpected program choice")
                else:
                    prescription_pages = set(choice["includePages"])
                    if choice.get("printedWeeks"):
                        actual_weeks = sorted({day["week"] for day in draft["workouts"]})
                        if actual_weeks != choice["printedWeeks"]:
                            branch["unmatched"].append({"field": "printedWeekCoverage", "expected": choice["printedWeeks"], "actual": actual_weeks})
            for day in draft["workouts"]:
                occurrence = {}
                previous_source_row = None
                for exercise in day["exercises"]:
                    branch["occurrences"] += 1
                    location = {"week": day["week"], "day": day["name"], "page": exercise.get("sourcePage"), "exercise": exercise["sourceName"]}
                    candidates = [row for row in document["rows"] if row["page"] == location["page"] and key(row["name"]) == key(location["exercise"])]
                    labeled = [row for row in candidates if row["day"] and (key(day["name"]) in key(row["day"]) or key(row["day"]) in key(day["name"]))]
                    if not labeled:
                        day_number = re.fullmatch(r"day\s+(\d+)", day["name"], re.I)
                        if day_number:
                            tables = sorted({row["table"] for row in document["rows"] if row["page"] == location["page"]})
                            page_days = [workout for workout in draft["workouts"] if workout["week"] == day["week"] and workout.get("sourcePage") == location["page"]]
                            position = next((index for index, workout in enumerate(page_days) if workout is day), None)
                            if position is not None and len(tables) == len(page_days):
                                labeled = [row for row in candidates if row["table"] == tables[position]]
                    if labeled:
                        candidates = labeled
                    if not candidates:
                        branch["unmatched"].append(location)
                        continue
                    identity = (location["page"], key(location["exercise"]))
                    offset = occurrence.get(identity, 0)
                    occurrence[identity] = offset + 1
                    if len(candidates) > 1 and not labeled and len({row["day"] for row in candidates}) > 1:
                        branch["unmatched"].append(location | {"reason": "ambiguous source day"})
                        continue
                    if offset >= len(candidates):
                        branch["unmatched"].append(location | {"reason": "source row reused within one day"})
                        continue
                    row = candidates[offset]
                    source_position = (row["page"], row["table"], row["row"])
                    if previous_source_row is not None and source_position < previous_source_row:
                        branch["discrepancies"].append(location | {"issues": [{"field": "exerciseOrder", "previousSourceRow": previous_source_row, "actualSourceRow": source_position}]})
                    previous_source_row = source_position
                    covered.add((row["page"], row["table"], row["row"]))
                    fields, issues = compare(row, exercise)
                    branch["comparisons"].append(location | {"sourceTable": row["table"], "sourceRow": row["row"],
                        "expected": {field: row.get(field) for field in ("working", "warmups", "reps", "rir", "rirBySet", "rpe", "earlyRpe", "lastRpe", "load", "tempo", "rest", "technique", "notes", "footer", "substitutions")},
                        "actual": {field: exercise.get(field) for field in ("sourceName", "sets", "notes", "substitutions", "demoUrl", "demoLinks")}, "issues": issues})
                    branch["fields"] += fields
                    if issues:
                        branch["discrepancies"].append(location | {"sourceTable": row["table"], "sourceRow": row["row"], "issues": issues})
            for row in document["rows"]:
                bounds = count_bounds(row["working"])
                source_id = (row["page"], row["table"], row["row"])
                if row["page"] in prescription_pages and bounds and bounds[0] > 0 and source_id not in covered:
                    branch["uncoveredSourceRows"].append({"page": row["page"], "table": row["table"],
                                                          "row": row["row"], "day": row["day"], "exercise": row["name"]})
            report.append(branch)
            print(f"{path.stem}: {branch['occurrences']} exercises, {branch['fields']} fields, {len(branch['unmatched'])} unmatched, {len(branch['discrepancies'])} discrepant, {len(branch['uncoveredSourceRows'])} uncovered source rows")
    return report


if __name__ == "__main__":
    documents = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    inventory = json.loads(Path(sys.argv[4]).read_text(encoding="utf-8")) if len(sys.argv) > 4 else None
    result = audit(documents, sys.argv[2], inventory)
    Path(sys.argv[3]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if any(branch["unmatched"] or branch["discrepancies"] or branch.get("uncoveredSourceRows") for branch in result):
        raise SystemExit(1)
