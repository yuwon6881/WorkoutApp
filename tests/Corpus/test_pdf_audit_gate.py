"""Regression checks for the strict independent corpus gate (standard library only)."""

from contextlib import redirect_stdout
import copy
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
GATE = runpy.run_path(str(ROOT / "scripts/pdf-audit-gate.py"))["gate"]


class SourceAuditGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.folder = Path(self.directory.name)
        document = {"key": "changed_title", "pdf": "changed title.pdf", "sha256": "reviewed-hash", "pageCount": 1}
        self.inventory = [document | {"choices": [{"id": "", "includePages": [1], "printedWeeks": [1]}]}]
        self.rows = [document | {"rows": [{"page": 1, "table": 0, "row": 1, "day": "Day 1", "name": "Cable row",
            "working": "1", "warmups": "0", "reps": "9-11", "rest": "~2-4 min", "rirBySet": ["2"],
            "substitutions": [], "context": {}}]}]
        self.links = [document | {"links": [], "rejected": []}]
        self.draft = {"workouts": [{"week": 1, "name": "Day 1", "sourcePage": 1, "exercises": [{
            "sourceName": "Cable row", "sourcePage": 1, "notes": None, "substitutions": [], "sets": [{
                "warmup": False, "repMin": 9, "repMax": 11, "rir": "2", "targetRpe": 8,
                "restSeconds": 180, "restText": "~2-4 min", "notes": None}]}]}]}
        (self.folder / "changed_title.json").write_text(json.dumps(document), encoding="utf-8")

    def tearDown(self):
        self.directory.cleanup()

    def run_gate(self, draft=None):
        for suffix in ("", ".drift"):
            (self.folder / f"changed_title{suffix}.draft").write_text(json.dumps(draft or self.draft), encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            return GATE(self.rows, self.links, self.inventory, self.folder, self.folder / "report")

    def test_source_grounded_normal_and_drift_pass(self):
        self.assertTrue(self.run_gate())

    def test_changed_rest_average_fails(self):
        changed = copy.deepcopy(self.draft)
        changed["workouts"][0]["exercises"][0]["sets"][0]["restSeconds"] = 120
        self.assertFalse(self.run_gate(changed))

    def test_missing_separate_hold_target_fails(self):
        self.rows[0]["rows"][0].update(reps="HOLD", hold="20 SEC")
        changed = copy.deepcopy(self.draft)
        changed["workouts"][0]["exercises"][0]["sets"][0].update(repMin=None, repMax=None, repsText="HOLD")
        self.assertFalse(self.run_gate(changed))
        changed["workouts"][0]["exercises"][0]["sets"][0]["repsText"] = "20 SEC"
        self.assertTrue(self.run_gate(changed))

    def test_ignored_last_set_failure_fails(self):
        self.rows[0]["rows"][0].update(lastSetFailure="Y", rirBySet=[], rpe="8")
        self.assertFalse(self.run_gate())
        changed = copy.deepcopy(self.draft)
        exercise = changed["workouts"][0]["exercises"][0]
        exercise['notes'] = 'LSTF: Y. Take the last set to failure.'
        exercise['sets'][0].update(targetRpe=10, rir="0")
        self.assertTrue(self.run_gate(changed))

    def test_inserted_coaching_glyph_fails(self):
        self.rows[0]["rows"][0]["notes"] = "LEAN INTO THE RAISE"
        changed = copy.deepcopy(self.draft)
        changed["workouts"][0]["exercises"][0]["notes"] = "LEAN N INTO THE RAISE"
        self.assertFalse(self.run_gate(changed))

    def test_complete_coaching_note_with_footer_passes(self):
        self.rows[0]["rows"][0]["notes"] = "LEAN INTO THE RAISE"
        changed = copy.deepcopy(self.draft)
        changed["workouts"][0]["exercises"][0]["notes"] = "LEAN INTO THE RAISE — FINAL SET TO FAILURE"
        self.assertTrue(self.run_gate(changed))

    def test_omitted_source_exercise_fails(self):
        changed = copy.deepcopy(self.draft)
        changed["workouts"][0]["exercises"] = []
        self.assertFalse(self.run_gate(changed))

    def test_missing_choice_fails(self):
        self.inventory[0]["choices"].append({"id": "alternative", "includePages": [1], "printedWeeks": [1]})
        self.assertFalse(self.run_gate())

    def test_changed_pdf_hash_fails(self):
        self.inventory[0]["sha256"] = "different-hash"
        self.assertFalse(self.run_gate())

    def test_unreviewed_pdf_fails(self):
        (self.folder / "new_pdf.json").write_text("{}", encoding="utf-8")
        self.assertFalse(self.run_gate())


if __name__ == "__main__":
    unittest.main()
