"""Independent effort ownership derived from the printed coaching cells."""
import math
import re


def failure(text):
    return bool(re.search(r"(?:to|hit|reach(?:ing)?)\s+(?:true\s+)?failure\b", text, re.I)) and not re.search(
        r"avoid failure|without failure|(?:not|never|don't)[^.!?]{0,60}failure|(?:shy|short) of failure", text, re.I)


def expected(row, count):
    note = row.get("notes") or ""
    pieces = re.split(r"\bSet\s+(\d+)\b", note, flags=re.I)
    candidates = {}
    for position in range(1, len(pieces), 2):
        index, clause = int(pieces[position]) - 1, pieces[position + 1]
        prefix = pieces[position - 1].rstrip()
        if prefix and prefix[-1] not in '.!?;':
            continue
        if re.search(r'\b(?:if|unless|when)\b', clause, re.I):
            continue
        if not 0 <= index < count:
            continue
        printed = re.search(r"RPE\s+(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)", clause, re.I)
        value = None
        if printed:
            values = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", printed[1])]
            if all(0 <= n <= 10 for n in values) and values == sorted(values):
                if max(values) <= 5:
                    value = (None, "5+", printed[1])
                elif min(values) >= 5:
                    effort = math.floor(sum(values) / len(values) + 0.5)
                    value = (effort if effort >= 6 else None, str(10 - effort), printed[1])
        elif failure(clause):
            value = (10, "0", None)
        if value is not None:
            candidates.setdefault(index, set()).add(value)
    result = {index: next(iter(values)) for index, values in candidates.items() if len(values) == 1}
    stated = [str(row.get(field) or '') for field in ('rpe', 'earlyRpe', 'lastRpe', 'rir')]
    stated = [re.sub(r'\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%', '', text) for text in stated]
    if count == 1 and not any(re.search(r'\d', text) for text in stated) and not any(re.search(r'\d', text or '') for text in row.get('rirBySet', [])) and not re.search(r'\b(?:if|when|unless)\b', note, re.I):
        targets = set(re.findall(r'@\s*RPE\s*(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)(?![\d.])', note, re.I))
        if len(targets) == 1:
            printed = next(iter(targets))
            values = [float(n) for n in re.findall(r'\d+(?:\.\d+)?', printed)]
            if values == sorted(values) and all(5 <= n <= 10 for n in values):
                effort = math.floor(sum(values) / len(values) + 0.5)
                result[0] = (effort if effort >= 6 else None, str(10 - effort), printed)
    if count - 1 not in result and not row.get("lastRpe") and failure(note):
        scoped = re.search(r"(?:last|final)\s+set\b[^.!?]{0,120}(?:to|hit|reach(?:ing)?)\s+(?:true\s+)?failure", note, re.I)
        if scoped:
            result[count - 1] = (10, "0", None)
    return result
