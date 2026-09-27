"""Independent interpretation of affirmative partial-ROM source instructions.

Retains the source wording and rejects explanatory-only mentions. Unclear scopes
remain review work rather than being filled from the application's imported output.
"""

import re

ROM = r"[~≈]?(?:half\s*(?:of\s+(?:the\s+)?)?|(?:1/[234]|[23]/4|2/3|[¼½¾])\s*(?:of\s+(?:the\s+)?)?)(?:rom|range\s+of\s+motion)"


def technique(text, column=False):
    if not text or re.search(r"\b(?:avoid|never|do not|don't)\s+(?:(?:using|doing|performing|lengthened|integrated)\s+)*partial", text, re.I):
        return None
    affirmative = column or re.search(r"\b(?:perform(?:ed|ing)?|use|do|stay|keep|switch|alternate|continue|extend|all reps|cut out|only|first|last)\b", text, re.I)
    counted = re.search(r"\d+\s*(?:reps?\s*)?(?:top|bottom)\s*" + ROM, text, re.I)
    if not affirmative and not counted:
        return None
    if re.search(r"integrated\s+partials|alternate.{0,70}(?:half|partial)", text, re.I):
        return "integrated"
    if re.search(r"(?:lengthened|long[- ]length)\s+partials", text, re.I):
        return "lengthened"
    if re.search(r"\bpartial\s*(?:reps?|rom)|(?:short|reduced)\s+(?:ROM|range of motion)|(?:top|bottom)\s*[- ]?" + ROM + r"|(?:top|bottom)[- ]half|(?:first|second)\s+" + ROM, text, re.I):
        return "partial"
    return None


def expected(row, count):
    result = [set() for _ in range(count)]
    for field in ("technique", "notes"):
        text = row.get(field, "")
        method = technique(text, column=field == "technique")
        if method is None:
            continue
        if re.search(r"all\s+(?:working\s+)?sets|all\s+reps\s+and\s+sets|each\s+set", text, re.I):
            indices = range(count)
        elif re.search(r"\b(?:final|last)\s+(?:working\s+)?set\b", text, re.I):
            indices = [count - 1]
        elif match := re.search(r"\b(?:on|for)\s+set\s+(\d+)\b", text, re.I):
            indices = [int(match[1]) - 1]
        else:
            indices = [count - 1] if field == "technique" else range(count)
        for index in indices:
            if 0 <= index < count:
                result[index].add(method)
    return result


def actual(text):
    text = text or ""
    return {name for name, pattern in (
        ("integrated", r"integrated\s+partials"),
        ("lengthened", r"(?:lengthened|long[- ]length)\s+partials"),
        ("partial", r"\bpartial\s+reps?|(?:top|bottom)[- ]half\s+(?:rom|reps?)")
    ) if re.search(pattern, text, re.I)}
