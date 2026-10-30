"""Smoke test backend tanpa menjalankan server: import app dan panggil route."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server import main  # noqa: E402


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

    def test_snapshot_contract(self):
        snap = json.loads(main.snapshot().body)
        self.assertIn("cpuT", snap)
        self.assertIn("drives", snap)
        self.assertIn("snap", snap)
        self.assertIsInstance(snap["drives"], list)


if __name__ == "__main__":
    unittest.main()
