"""Smoke test backend tanpa menjalankan server: import app dan panggil route."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server import main  # noqa: E402
from server.main import build_log_columns  # noqa: E402


class ApiSmokeTest(unittest.TestCase):
    def test_index_serves_web_shell(self):
        body = main.index().body.decode()
        self.assertIn('<main id="root">', body)
        self.assertIn("core/shell.js", body)

    def test_schema_contract(self):
        data = json.loads(main.api_schema().body)
        self.assertIn("cpuT", data)
        self.assertEqual(data["cpuT"]["unit"], "°C")
        self.assertGreater(len(data), 20)

    def test_themes_include_default_and_minimal(self):
        themes = json.loads(main.api_themes().body)["themes"]
        names = {t["name"] for t in themes}
        self.assertIn("default", names)
        self.assertIn("minimal", names)

    def test_mock_routes_do_not_touch_hardware(self):
        snap = json.loads(main.mock_snapshot().body)
        self.assertIn("cpuT", snap)
        self.assertIn("snap", snap)
        health = json.loads(main.mock_health().body)
        self.assertIn("items", health)

    def test_log_sessions_is_a_list(self):
        data = json.loads(main.log_sessions().body)
        self.assertIsInstance(data["sessions"], list)

    def test_recording_modes_have_expected_columns(self):
        minimal = build_log_columns(None, "minimal")
        self.assertEqual(minimal, ["cpuT", "cpuW", "gT", "gW", "vbw", "prx", "majF", "r0"])
        snap = {"cpuT": 50.0, "cpuU": 10.0, "pu": [1.0, 2.0], "pf": [3.0, 4.0],
                "eu": [5.0], "drives": [{"dev": "sda"}], "r0": 1.0, "w0": 2.0}
        detailed = build_log_columns(snap, "detailed")
        for col in ("pu0", "pu1", "eu0", "r0", "w0"):
            self.assertIn(col, detailed)
        self.assertNotIn("pu0", minimal)

    def test_log_data_returns_all_columns(self):
        old_logs = main.LOGS
        try:
            with tempfile.TemporaryDirectory(dir=ROOT / "tests") as td:
                main.LOGS = Path(td)
                d = Path(td) / "sess"
                d.mkdir()
                (d / "meta.json").write_text(json.dumps({"id": 123, "mode": "detailed"}))
                (d / "samples.csv").write_text(
                    "timestamp_ms,cpuT,pu0,thr\n"
                    "1793000000000,45.500,3.000,gpu idle\n"
                    "1793000001000,,4.000,\n")
                data = json.loads(main.log_data("123").body)
                self.assertEqual(data["columns"], ["timestamp_ms", "cpuT", "pu0", "thr"])
                self.assertEqual(len(data["rows"]), 2)
                self.assertEqual(data["rows"][0][1], 45.5)
                self.assertEqual(data["rows"][0][3], "gpu idle")
                self.assertIsNone(data["rows"][1][1])
                self.assertEqual(data["meta"]["mode"], "detailed")
        finally:
            main.LOGS = old_logs

    def test_snapshot_contract(self):
        snap = json.loads(main.snapshot().body)
        self.assertIn("cpuT", snap)
        self.assertIn("drives", snap)
        self.assertIn("snap", snap)
        self.assertIsInstance(snap["drives"], list)


if __name__ == "__main__":
    unittest.main()
