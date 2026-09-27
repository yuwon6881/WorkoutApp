"""Write the source corpus inventory and explicitly printed program/week choices.

Choice page ranges are reviewed PDF evidence, not production parsing rules.
Never obtain expected prescriptions or coverage from an imported draft.
"""

import json
from pathlib import Path
import re
import sys


def inventory(documents):
    result = []
    for source in documents:
        entry = {key: source[key] for key in ("pdf", "key", "sha256", "pageCount")}
        # These pages are the general warm-up reference or explanatory screenshots
        # of earlier workouts in the handbook, not additional scheduled sessions.
        references = {
            "High_Frequency_Full_Body_Program_4xweek": [34],
            "High_Frequency_Full_Body_Program_5xweek": [35],
            "Intermediate_Advanced_PPL_Program_6xweek": [30],
            "Powerbuilding_2.0_4xweek": [36, 82, 84],
            "Powerbuilding_2.0_5-6xweek": [36, 80, 82],
            "Powerbuilding_3.0_4xweek": [36, 75, 77],
            "Powerbuilding-3.0_5xweek": [36, 75, 77],
            "Powerbuilding-System_4xweek": [33, 78, 80],
            "Powerbuilding-System_5-6xweek": [33, 76, 78],
            "Upper_Lower_Program_4xweek": [31],
            "Upper_Lower_Program_6xweek": [31],
        }.get(source["key"], [])
        entry["referencePages"] = references
        entry["choices"] = [{"id": "", "includePages": sorted({row["page"] for row in source["rows"] if row["page"] not in references})}]
        if source["key"] == "Fundamentals_Hypertrophy_Program":
            entry["choices"] = [
                {"id": name, "includePages": list(range(first, last + 1)), "sourcePages": [first, last]}
                for name, first, last in [("full-body-program", 34, 48), ("upper-lower-program", 50, 64),
                                          ("bodypart-program", 66, 80)]
            ]
        versions = {
            "Powerbuilding_3.0_4xweek": ([65, 66], [67, 68]),
            "Powerbuilding-3.0_5xweek": ([65, 66], [67, 68]),
            "Powerbuilding-System_4xweek": ([63, 64], [65, 66]),
            "Powerbuilding-System_5-6xweek": ([63, 64], [65, 66]),
        }
        if source["key"] in versions:
            a, b = versions[source["key"]]
            pages = entry["choices"][0]["includePages"]
            entry["choices"] = [
                {"id": "week-a", "includePages": [page for page in pages if page not in b], "sourcePages": a},
                {"id": "week-b", "includePages": [page for page in pages if page not in a], "sourcePages": b},
            ]
        # Reviewed scheduled week ranges. Some covers/spine tabs are graphical or
        # contain superseded text; native text alone cannot decide their numbering.
        reviewed_counts = {
            "Arm_Hypertrophy_Program": 8, "Back_Hypertrophy_Program": 9,
            "Bench_Press_Specialization_Program": 8, "Chest_Hypertrophy_Program": 8,
            "Forearm_Hypertrophy_Program": 8, "Fundamentals_Hypertrophy_Program": 8,
            "High_Frequency_Full_Body_Program_4xweek": 10, "High_Frequency_Full_Body_Program_5xweek": 10,
            "Intermediate_Advanced_PPL_Program_6xweek": 16, "Neck_and_Trap_Guide": 8,
            "Powerbuilding_2.0_4xweek": 12, "Powerbuilding_2.0_5-6xweek": 12,
            "Powerbuilding_3.0_4xweek": 10, "Powerbuilding-3.0_5xweek": 10,
            "Powerbuilding-System_4xweek": 11, "Powerbuilding-System_5-6xweek": 11,
            "Pure_Bodybuilding_Phase_2_-_Full_Body": 10, "Pure_Bodybuilding_Phase_2_-_Upper_Lower": 10,
            "Purebodybuilding_Phase_2_-_PPL": 10, "Shoulder_Hypertrophy_Program": 8,
            "Squat_Specialization_Program": 10,
            "The_Essentials_Program_-_2xweek": 12, "The_Essentials_Program_-_3xweek": 12,
            "The_Essentials_Program_-_4xweek": 12, "The_Essentials_Program_-_5xweek": 12,
            "The_Ultimate_Push_Pull_Legs_System_-_4xweek": 13,
            "The_Ultimate_Push_Pull_Legs_System_-_5xweek": 13,
            "The_Ultimate_Push_Pull_Legs_System_-_6xweek": 13,
            "The_Bodybuilding_Transformation_System_-_Beginner": 12,
            "The_Bodybuilding_Transformation_System_-_Intermediate_Advanced": 12,
            "The_Min-Max_Phase2_Program__4X.pdf": 12, "The_Min-Max_Phase2_Program__5X.pdf": 12,
            "The_Min-Max_Program__4X": 12, "The_Min-Max_Program__5X": 12,
            "The_Pure_Bodybuilding_Program_-_Full_Body-1": 10,
            "The_Pure_Bodybuilding_Program_-_PPL": 10, "The_Pure_Bodybuilding_Program_-_UpperLower": 10,
            "Upper_Lower_Program_4xweek": 9, "Upper_Lower_Program_6xweek": 9,
        }
        for choice in entry["choices"]:
            weeks = set()
            previous = 0
            phase_end = 0
            offset = 0
            seen_pages = set()
            for row in source["rows"]:
                if row["page"] not in choice["includePages"] or row["page"] in seen_pages:
                    continue
                seen_pages.add(row["page"])
                labels = row["context"].get("weekLabels", [])
                if not labels:
                    continue
                match = re.fullmatch(r"WEEK\s*(\d+)[AB]?(?:\s*[-–]\s*(\d+))?", labels[0], re.I)
                if not match:
                    continue
                first, last = int(match[1]), int(match[2] or match[1])
                if first < previous:
                    offset += phase_end
                    phase_end = 0
                previous = first
                phase_end = max(phase_end, last)
                weeks.update(range(offset + first, offset + last + 1))
            choice["nativeWeekLabels"] = sorted(weeks)
            choice["printedWeeks"] = list(range(1, reviewed_counts[source["key"]] + 1))
            choice["weekCoverageSourcePages"] = [min(choice["includePages"]), max(choice["includePages"])]
        result.append(entry)
    return result


if __name__ == "__main__":
    source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    Path(sys.argv[2]).write_text(json.dumps(inventory(source), ensure_ascii=False, indent=2), encoding="utf-8")
