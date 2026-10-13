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

    def test_hold_time_in_coaching_must_reach_the_timer_target(self):
        self.rows[0]["rows"][0].update(reps="HOLD", notes="Hold dumbbells for 60 seconds")
        changed = copy.deepcopy(self.draft)
        exercise = changed['workouts'][0]['exercises'][0]
        exercise['notes'] = 'Hold dumbbells for 60 seconds'
        exercise['sets'][0].update(repMin=None, repMax=None, repsText='HOLD')
        self.assertFalse(self.run_gate(changed))
        exercise['sets'][0]['repsText'] = '60 seconds'
        self.assertTrue(self.run_gate(changed))

    def test_reserved_amrap_cannot_receive_an_invented_failure_instruction(self):
        self.rows[0]["rows"][0].update(reps="AMRAP", rpe="8", rirBySet=[])
        changed = copy.deepcopy(self.draft)
        set_plan = changed['workouts'][0]['exercises'][0]['sets'][0]
        set_plan.update(repMin=None, repMax=None, repsText='AMRAP', notes='To failure / AMRAP')
        self.assertFalse(self.run_gate(changed))
        set_plan['notes'] = 'AMRAP'
        self.assertTrue(self.run_gate(changed))

    def test_named_intensity_method_cannot_be_lost(self):
        self.rows[0]["rows"][0]['name'] = 'Cable row (Mechanical Dropset)'
        changed = copy.deepcopy(self.draft)
        exercise = changed['workouts'][0]['exercises'][0]
        exercise['sourceName'] = 'Cable row (Mechanical Dropset)'
        self.assertFalse(self.run_gate(changed))
        exercise['sets'][0]['notes'] = 'Dropset'
        self.assertTrue(self.run_gate(changed))

    def test_final_set_coached_failure_cannot_be_ignored(self):
        note = 'Take the last set to failure'
        self.rows[0]['rows'][0].update(notes=note, rpe='8', rirBySet=[])
        changed = copy.deepcopy(self.draft)
        exercise = changed['workouts'][0]['exercises'][0]
        exercise['notes'] = note
        self.assertFalse(self.run_gate(changed))
        exercise['sets'][0].update(targetRpe=10, rir='0')
        self.assertTrue(self.run_gate(changed))

    def test_indexed_low_effort_cannot_be_clamped_or_lost(self):
        note = 'Set 1 is pretty light (RPE 4-5).'
        self.rows[0]['rows'][0].update(notes=note, rpe='See Notes', rirBySet=[])
        changed = copy.deepcopy(self.draft)
        exercise = changed['workouts'][0]['exercises'][0]
        exercise['notes'] = note
        self.assertFalse(self.run_gate(changed))

        exercise['sets'][0].update(targetRpe=None, rir='5+', notes='Printed RPE: 4-5')
        self.assertTrue(self.run_gate(changed))
        exercise['sets'][0]['targetRpe'] = 6
        self.assertFalse(self.run_gate(changed))

    def test_conditional_effort_advice_does_not_become_a_target(self):
        note = 'Go heavier on set 2 if set 1 is RPE 9 or lower'
        self.rows[0]['rows'][0].update(notes=note, rpe='8', rirBySet=[])
        changed = copy.deepcopy(self.draft)
        changed['workouts'][0]['exercises'][0]['notes'] = note
        self.assertTrue(self.run_gate(changed))

    def test_missing_or_wrongly_scoped_coaching_dropset_fails(self):
        self.rows[0]["rows"][0].update(working="2", reps="9-11 (dropset)", notes="Last set only do a dropset")
        changed = copy.deepcopy(self.draft)
        exercise = changed["workouts"][0]["exercises"][0]
        exercise['notes'] = 'Last set only do a dropset'
        exercise['sets'] *= 2
        exercise['sets'][1] = copy.deepcopy(exercise['sets'][0])
        exercise['sets'][0]['repsText'] = '9-11'
        exercise['sets'][1]['repsText'] = '9-11 (dropset)'
        self.assertFalse(self.run_gate(changed))
        exercise['sets'][1]['notes'] = 'Dropset'
        self.assertTrue(self.run_gate(changed))
        exercise['sets'][0]['notes'] = 'Dropset'
        self.assertFalse(self.run_gate(changed))

    def test_coached_short_rest_mini_sets_require_myo_tag(self):
        note = 'Do 9 reps to failure. Rest 3-4 seconds. Do another 3 reps. Rest 2-3 seconds. Do another 3 reps'
        self.rows[0]["rows"][0].update(reps="9(+3+3)", notes=note)
        changed = copy.deepcopy(self.draft)
        exercise = changed["workouts"][0]["exercises"][0]
        exercise['notes'] = note
        exercise['sets'][0].update(repsText='9(+3+3)', repMin=9, repMax=9)
        self.assertFalse(self.run_gate(changed))
        exercise['sets'][0]['notes'] = 'Myo-reps'
        self.assertTrue(self.run_gate(changed))

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

    def test_wrapped_unilateral_link_name_preserves_exact_video_ownership(self):
        self.rows[0]["rows"][0]['substitutions'] = ['Half-Kneeling 1- Arm Lat Pulldown']
        self.links[0]['links'] = [{'page': 1, 'names': ['Half-Kneeling 1- Arm Lat Pulldown'],
                                 'identity': 'youtube:r8K1Fkch5go@0'}]
        changed = copy.deepcopy(self.draft)
        exercise = changed['workouts'][0]['exercises'][0]
        exercise['substitutions'] = ['Half-Kneeling 1- Arm Lat Pulldown']
        exercise['demoLinks'] = {'1 arm half kneeling lat pulldown': 'https://youtu.be/r8K1Fkch5go'}
        self.assertTrue(self.run_gate(changed))
        exercise['demoLinks']['1 arm half kneeling lat pulldown'] = 'https://youtu.be/8W67lZ5mwTU'
        self.assertFalse(self.run_gate(changed))


if __name__ == "__main__":
    unittest.main()
